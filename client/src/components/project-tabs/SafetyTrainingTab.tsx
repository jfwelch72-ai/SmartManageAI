import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";

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
  const { data: assignments = [], isLoading } = useQuery<TrainingAssignment[]>({
    queryKey: ["/api/safety-training/assignments", "project", projectId],
    queryFn: async () => {
      const all = await fetch("/api/safety-training/assignments", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all : [];
    },
  });

  const completed = assignments.filter(a => a.status === "COMPLETED").length;
  const pending = assignments.filter(a => a.status === "PENDING").length;
  const overdue = assignments.filter(a => a.status === "OVERDUE").length;
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
        <div className="flex gap-3 items-center text-sm text-muted-foreground">
          <span>{completed}/{total} completed</span>
          {pending > 0 && <Badge className="bg-amber-500/15 text-amber-700 border-transparent text-xs">{pending} pending</Badge>}
          {overdue > 0 && <Badge className="bg-red-500/15 text-red-700 border-transparent text-xs">{overdue} overdue</Badge>}
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
