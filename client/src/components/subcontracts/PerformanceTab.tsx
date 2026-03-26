import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, Plus, Loader2, Star, TrendingUp, AlertTriangle, Shield, ClipboardList } from "lucide-react";
import { format } from "date-fns";

interface PerformanceScore {
  id: string;
  contractId: string;
  periodDate: string;
  scheduleAdherence: number | null;
  workCompletionPercent: number | null;
  qualityScore: number | null;
  safetyIncidents: number;
  punchListItems: number;
  overallRating: string | null;
  notes: string | null;
  createdAt: string;
}

interface PerformanceData {
  contractId: string;
  latestScore: PerformanceScore | null;
  averageRating: string | null;
  history: PerformanceScore[];
}

interface PerformanceTabProps {
  contractId: string;
  canEdit: boolean;
}

export function PerformanceTab({ contractId, canEdit }: PerformanceTabProps) {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState({
    periodDate: new Date().toISOString().split("T")[0],
    scheduleAdherence: "",
    workCompletionPercent: "",
    qualityScore: "",
    safetyIncidents: "0",
    punchListItems: "0",
    notes: "",
  });

  const { data: performance, isLoading, isError, refetch } = useQuery<PerformanceData>({
    queryKey: ["/api/subcontracts", contractId, "performance"],
    queryFn: async () => {
      const res = await fetch(`/api/subcontracts/${contractId}/performance`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: { periodDate: string; scheduleAdherence?: number; workCompletionPercent?: number; qualityScore?: number; safetyIncidents: number; punchListItems: number; notes?: string }) => apiRequest("POST", `/api/subcontracts/${contractId}/performance`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts/performance/summary"] });
      toast({ title: "Performance score recorded" });
      setShowAddDialog(false);
      setForm({ periodDate: new Date().toISOString().split("T")[0], scheduleAdherence: "", workCompletionPercent: "", qualityScore: "", safetyIncidents: "0", punchListItems: "0", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const getRatingColor = (rating: number) => {
    if (rating >= 4) return "text-green-600";
    if (rating >= 3) return "text-yellow-600";
    if (rating >= 2) return "text-orange-600";
    return "text-red-600";
  };

  const getRatingLabel = (rating: number) => {
    if (rating >= 4.5) return "Excellent";
    if (rating >= 3.5) return "Good";
    if (rating >= 2.5) return "Fair";
    if (rating >= 1.5) return "Poor";
    return "Critical";
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>;
  }

  if (isError) {
    return <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground"><p>Failed to load performance data.</p><Button variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  }

  const latest = performance?.latestScore;
  const avgRating = performance?.averageRating ? parseFloat(performance.averageRating) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-performance-title">
          <BarChart3 className="h-5 w-5" />
          Performance Tracking
        </h3>
        {canEdit && (
          <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-performance">
            <Plus className="h-4 w-4 mr-2" />Record Score
          </Button>
        )}
      </div>

      {latest ? (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Card data-testid="card-overall-rating">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3" />Overall Rating</CardTitle></CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${getRatingColor(parseFloat(latest.overallRating || "0"))}`}>
                {parseFloat(latest.overallRating || "0").toFixed(1)}/5.0
              </p>
              <p className="text-xs text-muted-foreground">{getRatingLabel(parseFloat(latest.overallRating || "0"))}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />Schedule</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{latest.scheduleAdherence ?? "-"}%</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><BarChart3 className="h-3 w-3" />Completion</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{latest.workCompletionPercent ?? "-"}%</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3" />Quality</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{latest.qualityScore ?? "-"}%</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Shield className="h-3 w-3" />Safety</CardTitle></CardHeader>
            <CardContent><p className={`text-2xl font-bold ${latest.safetyIncidents > 0 ? "text-red-600" : "text-green-600"}`}>{latest.safetyIncidents}</p><p className="text-xs text-muted-foreground">incidents</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><ClipboardList className="h-3 w-3" />Punch List</CardTitle></CardHeader>
            <CardContent><p className={`text-2xl font-bold ${latest.punchListItems > 0 ? "text-yellow-600" : "text-green-600"}`}>{latest.punchListItems}</p><p className="text-xs text-muted-foreground">items</p></CardContent>
          </Card>
        </div>
      ) : (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No performance scores recorded yet.</CardContent></Card>
      )}

      {performance?.averageRating && performance.history.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Average Rating: <span className={getRatingColor(avgRating)}>{avgRating.toFixed(1)}/5.0</span> ({getRatingLabel(avgRating)})</CardTitle></CardHeader>
        </Card>
      )}

      {performance?.history && performance.history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Score History ({performance.history.length} entries)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-center">Schedule</TableHead>
                  <TableHead className="text-center">Completion</TableHead>
                  <TableHead className="text-center">Quality</TableHead>
                  <TableHead className="text-center">Safety</TableHead>
                  <TableHead className="text-center">Punch List</TableHead>
                  <TableHead className="text-center">Overall</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performance.history.map(score => (
                  <TableRow key={score.id} data-testid={`row-performance-${score.id}`}>
                    <TableCell>{format(new Date(score.periodDate), "MMM yyyy")}</TableCell>
                    <TableCell className="text-center">{score.scheduleAdherence ?? "-"}%</TableCell>
                    <TableCell className="text-center">{score.workCompletionPercent ?? "-"}%</TableCell>
                    <TableCell className="text-center">{score.qualityScore ?? "-"}%</TableCell>
                    <TableCell className="text-center">{score.safetyIncidents > 0 ? <span className="text-red-600 font-medium">{score.safetyIncidents}</span> : "0"}</TableCell>
                    <TableCell className="text-center">{score.punchListItems}</TableCell>
                    <TableCell className="text-center"><span className={`font-bold ${getRatingColor(parseFloat(score.overallRating || "0"))}`}>{parseFloat(score.overallRating || "0").toFixed(1)}</span></TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{score.notes || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Performance Score</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Period Date</Label>
              <Input type="date" value={form.periodDate} onChange={e => setForm({ ...form, periodDate: e.target.value })} data-testid="input-perf-date" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Schedule Adherence (%)</Label>
                <Input type="number" min="0" max="100" value={form.scheduleAdherence} onChange={e => setForm({ ...form, scheduleAdherence: e.target.value })} placeholder="0-100" data-testid="input-schedule-adherence" />
              </div>
              <div>
                <Label>Work Completion (%)</Label>
                <Input type="number" min="0" max="100" value={form.workCompletionPercent} onChange={e => setForm({ ...form, workCompletionPercent: e.target.value })} placeholder="0-100" data-testid="input-work-completion" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Quality Score (%)</Label>
                <Input type="number" min="0" max="100" value={form.qualityScore} onChange={e => setForm({ ...form, qualityScore: e.target.value })} placeholder="0-100" data-testid="input-quality-score" />
              </div>
              <div>
                <Label>Safety Incidents</Label>
                <Input type="number" min="0" value={form.safetyIncidents} onChange={e => setForm({ ...form, safetyIncidents: e.target.value })} data-testid="input-safety-incidents" />
              </div>
            </div>
            <div>
              <Label>Punch List Items</Label>
              <Input type="number" min="0" value={form.punchListItems} onChange={e => setForm({ ...form, punchListItems: e.target.value })} data-testid="input-punch-list" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="input-perf-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate({
                periodDate: form.periodDate,
                scheduleAdherence: form.scheduleAdherence ? parseInt(form.scheduleAdherence) : undefined,
                workCompletionPercent: form.workCompletionPercent ? parseInt(form.workCompletionPercent) : undefined,
                qualityScore: form.qualityScore ? parseInt(form.qualityScore) : undefined,
                safetyIncidents: parseInt(form.safetyIncidents) || 0,
                punchListItems: parseInt(form.punchListItems) || 0,
                notes: form.notes || undefined,
              })}
              disabled={!form.periodDate || addMutation.isPending}
              data-testid="button-submit-performance"
            >
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record Score"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
