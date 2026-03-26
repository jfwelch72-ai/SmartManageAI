import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TrainingAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  trainingTitle: string;
  trainingCategory: string;
  trainingDuration: number | null;
  status: string;
  assignedAt: string;
  dueDate: string | null;
  completedAt: string | null;
  completedByName: string | null;
  notes: string | null;
}

interface SafetyTrainingTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function SafetyTrainingTab({ projectId, projectCode, userRole }: SafetyTrainingTabProps) {
  const { toast } = useToast();
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [completing, setCompleting] = useState<TrainingAssignment | null>(null);
  const [completedByName, setCompletedByName] = useState("");
  const [notes, setNotes] = useState("");
  const [ack, setAck] = useState(false);

  const { data: assignments = [], isLoading } = useQuery<TrainingAssignment[]>({
    queryKey: ["/api/safety-training/assignments", "project", projectId],
    queryFn: async () => {
      const all = await fetch("/api/safety-training/assignments", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all : [];
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: string; completedByName: string; notes: string; acknowledgment: string }) =>
      apiRequest("PATCH", `/api/safety-training/assignments/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-training/assignments", "project", projectId] });
      setShowCompleteDialog(false);
      setCompleting(null);
      setCompletedByName("");
      setNotes("");
      setAck(false);
      toast({ title: "Training marked complete" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const completed = assignments.filter(a => a.status === "COMPLETED").length;
  const total = assignments.length;

  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded" />)}</div>;
  }

  return (
    <div className="space-y-4" data-testid="project-safety-training-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Safety Training</h3>
        </div>
        <div className="flex gap-3 items-center">
          <span className="text-sm text-muted-foreground">{completed}/{total} completed</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`/api/safety-training/export/pdf`, "_blank")}
            data-testid="button-export-training-pdf"
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export PDF
          </Button>
        </div>
      </div>

      {assignments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg" data-testid="empty-project-training">
          <ShieldCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No safety training assignments</p>
          <p className="text-xs mt-1">Assign training from the Safety Training module.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map(a => (
            <Card key={a.id} className="p-4" data-testid={`card-training-assignment-${a.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{a.trainingTitle}</span>
                    {a.status === "COMPLETED" && <Badge className="bg-green-500/15 text-green-700 border-transparent text-xs">Completed</Badge>}
                    {a.status === "OVERDUE" && <Badge className="bg-red-500/15 text-red-700 border-transparent text-xs">Overdue</Badge>}
                    {a.status === "PENDING" && <Badge className="bg-amber-500/15 text-amber-700 border-transparent text-xs">Pending</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{a.employeeName}</span>
                    <span>{a.trainingCategory}</span>
                    {a.trainingDuration && <span>{a.trainingDuration} min</span>}
                    <span>Assigned {fmtDate(a.assignedAt)}</span>
                    {a.dueDate && <span>Due {fmtDate(a.dueDate)}</span>}
                    {a.completedAt && <span className="text-green-700">Completed {fmtDate(a.completedAt)}{a.completedByName ? ` by ${a.completedByName}` : ""}</span>}
                  </div>
                </div>
                {a.status !== "COMPLETED" && ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setCompleting(a); setShowCompleteDialog(true); }}
                    data-testid={`button-complete-training-${a.id}`}
                  >
                    Complete
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCompleteDialog} onOpenChange={(open) => { if (!open) { setShowCompleteDialog(false); setCompleting(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Training</DialogTitle>
            <DialogDescription>Mark "{completing?.trainingTitle}" as completed for {completing?.employeeName}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Completed By</Label>
              <Input value={completedByName} onChange={e => setCompletedByName(e.target.value)} placeholder="Name of trainer/supervisor" data-testid="input-completed-by" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" data-testid="input-training-notes" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ack" checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-acknowledge" />
              <Label htmlFor="ack" className="text-sm">I confirm this training has been completed satisfactorily.</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCompleteDialog(false); setCompleting(null); }} data-testid="button-cancel-complete">Cancel</Button>
            <Button
              disabled={!ack || !completedByName || completeMutation.isPending}
              onClick={() => completing && completeMutation.mutate({ id: completing.id, status: "COMPLETED", completedByName, notes, acknowledgment: "confirmed" })}
              data-testid="button-confirm-complete-training"
            >
              {completeMutation.isPending ? "Saving..." : "Mark Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
