import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Award, Plus, Loader2, Pencil, Trash2, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import {
  ProjectSelect,
  formatMoney,
  getErrorMessage,
} from "@/components/dot/FieldFormHelpers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import type { ProjectDbeGoal } from "@shared/schema";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";

interface DbeGoalRisk {
  certificationType: string;
  goalPercent: number;
  actualPercent: number;
  actualDollars: number;
  committedDollars: number;
  riskScore: number;
  riskBand: "LOW" | "MEDIUM" | "HIGH";
}
interface DbeRiskResponse {
  fallback?: boolean;
  message?: string;
  overallRiskScore: number;
  overallRiskBand: "LOW" | "MEDIUM" | "HIGH";
  goals: DbeGoalRisk[];
  aiCommentary?: string;
  aiRecommendations?: string[];
}

const CERT_TYPES = [
  "DBE",
  "MBE",
  "WBE",
  "SBE",
  "VOSB",
  "SDVOSB",
  "HUBZONE",
  "EIGHTA",
  "ACDBE",
  "OTHER",
];

type Editing = ProjectDbeGoal | "new" | null;

export default function DbeGoalsPage() {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageDbeGoals");
  const canView = useFeaturePermission("canViewDbeGoals");
  const canAccess = canView || canManage;
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDbeGoal | null>(null);
  const queryKey = ["/api/projects", projectId, "dbe-goals"];
  const { data = [], isLoading } = useQuery<ProjectDbeGoal[]>({
    queryKey,
    enabled: !!projectId && canAccess,
  });

  if (!canAccess) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-dbe-goals">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            You don't have permission to view DBE Goals.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [riskOpen, setRiskOpen] = useState(false);
  const riskMut = useMutation<DbeRiskResponse, Error, void>({
    mutationFn: async () => {
      const r = await apiRequest(
        "POST",
        "/api/ai-features/heavy-civil/dbe/risk-score",
        { projectId },
      );
      return (await r.json()) as DbeRiskResponse;
    },
    onError: (error: Error) =>
      toast({
        title: "DBE risk score failed",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/dbe-goals/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Goal deleted" });
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "dbe-goals"],
      });
      setDeleteTarget(null);
    },
    onError: (error: Error) =>
      toast({
        title: "Failed to delete",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  return (
    <div className="container max-w-full mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">DBE Goals</h1>
          <p className="text-sm text-muted-foreground">
            Disadvantaged Business Enterprise participation goals — DBE, MBE,
            WBE, SBE, VOSB and more.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <ContextualHelpButton />
          <div className="flex items-center gap-2">
            {canAccess && projectId && (
            <Button
              variant="outline"
              disabled={riskMut.isPending}
              onClick={() => {
                setRiskOpen(true);
                riskMut.mutate();
              }}
              data-testid="button-dbe-risk-ai"
            >
              {riskMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              AI Risk Score
            </Button>
          )}
          {canManage && (
            <Button
              disabled={!projectId}
              onClick={() => setEditing("new")}
              data-testid="button-new-dbe-goal"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Goal
            </Button>
          )}
          </div>
        </div>
      </div>

      <Dialog open={riskOpen} onOpenChange={setRiskOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>DBE Participation Risk</DialogTitle>
          </DialogHeader>
          {riskMut.isPending ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Computing risk…
            </div>
          ) : riskMut.data ? (
            <div
              className="space-y-3 text-sm"
              data-testid="text-dbe-risk-result"
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    riskMut.data.overallRiskBand === "HIGH"
                      ? "destructive"
                      : riskMut.data.overallRiskBand === "MEDIUM"
                        ? "secondary"
                        : "default"
                  }
                >
                  {riskMut.data.overallRiskBand}
                </Badge>
                <span>
                  Overall risk score:{" "}
                  <strong>{riskMut.data.overallRiskScore}/100</strong>
                </span>
              </div>
              <div className="border rounded p-3 space-y-2">
                {riskMut.data.goals?.map((g) => (
                  <div key={g.certificationType} className="text-xs">
                    <strong>{g.certificationType}</strong> — goal{" "}
                    {g.goalPercent}%, paid {g.actualPercent.toFixed(2)}% ($
                    {g.actualDollars.toLocaleString()}) · committed $
                    {g.committedDollars.toLocaleString()} · risk {g.riskScore}
                    /100 ({g.riskBand})
                  </div>
                ))}
              </div>
              {riskMut.data.aiCommentary && (
                <div>
                  <strong>AI commentary:</strong> {riskMut.data.aiCommentary}
                </div>
              )}
              {Array.isArray(riskMut.data.aiRecommendations) &&
                riskMut.data.aiRecommendations.length > 0 && (
                  <div>
                    <strong>Recommendations:</strong>
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      {riskMut.data.aiRecommendations.map(
                        (r: string, k: number) => (
                          <li key={k}>{r}</li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No data.</div>
          )}
        </DialogContent>
      </Dialog>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Project *</Label>
        <ProjectSelect
          value={projectId}
          onChange={setProjectId}
          testId="select-dbe-project-filter"
        />
      </div>

      {!projectId ? (
        <EmptyState
          icon={Award}
          title="Select a project"
          description="Choose a project above to view or create its DBE participation goals."
          testId="empty-dbe-no-project"
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="animate-spin h-5 w-5 mr-2" />
          Loading…
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No DBE goals set"
          description="Add a participation goal for this project."
          testId="empty-dbe-goals"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((g) => (
            <Card key={g.id} data-testid={`card-dbe-goal-${g.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">
                    {g.certificationType}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Badge variant="default">
                      {Number(g.goalPercent).toFixed(2)}%
                    </Badge>
                    {canManage && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setEditing(g)}
                          data-testid={`button-edit-dbe-${g.id}`}
                          aria-label="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setDeleteTarget(g)}
                          data-testid={`button-delete-dbe-${g.id}`}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {g.goalDollars && (
                  <div>
                    <span className="text-muted-foreground">Goal $:</span>{" "}
                    {formatMoney(g.goalDollars)}
                  </div>
                )}
                {g.notes && (
                  <div className="text-xs text-muted-foreground line-clamp-3 pt-1">
                    {g.notes}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        {editing !== null && (
          <DbeGoalForm
            key={editing === "new" ? "new" : editing.id}
            existing={editing === "new" ? null : editing}
            projectId={projectId}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-dbe-goal">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete DBE Goal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the{" "}
              <strong>{deleteTarget?.certificationType}</strong> participation
              goal (
              {deleteTarget ? Number(deleteTarget.goalPercent).toFixed(2) : ""}
              %) for this project. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-dbe-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={delMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) delMut.mutate(deleteTarget.id);
              }}
              data-testid="button-delete-dbe-confirm"
            >
              {delMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormState {
  certificationType: string;
  goalPercent: string;
  goalDollars: string;
  notes: string;
}

function initial(existing: ProjectDbeGoal | null): FormState {
  if (!existing)
    return {
      certificationType: "DBE",
      goalPercent: "",
      goalDollars: "",
      notes: "",
    };
  return {
    certificationType: existing.certificationType,
    goalPercent: existing.goalPercent ?? "",
    goalDollars: existing.goalDollars ?? "",
    notes: existing.notes ?? "",
  };
}

function DbeGoalForm({
  existing,
  onClose,
  projectId,
}: {
  existing: ProjectDbeGoal | null;
  onClose: () => void;
  projectId: string;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initial(existing));
  useEffect(() => {
    setForm(initial(existing));
  }, [existing]);

  const mut = useMutation({
    mutationFn: async (data: FormState) => {
      const payload: Record<string, unknown> = {
        ...data,
        goalDollars: data.goalDollars || null,
      };
      const url = existing
        ? `/api/projects/${projectId}/dbe-goals/${existing.id}`
        : `/api/projects/${projectId}/dbe-goals`;
      const r = await apiRequest(existing ? "PATCH" : "POST", url, payload);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: existing ? "Goal updated" : "DBE goal saved" });
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "dbe-goals"],
      });
      onClose();
    },
    onError: (error: Error) =>
      toast({
        title: "Failed to save",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{existing ? "Edit DBE Goal" : "New DBE Goal"}</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate(form);
        }}
        className="space-y-3"
      >
        <div>
          <Label>Certification Type *</Label>
          <Select
            value={form.certificationType}
            onValueChange={(v) => setForm({ ...form, certificationType: v })}
          >
            <SelectTrigger data-testid="select-dbe-cert-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CERT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Goal % *</Label>
            <Input
              required
              inputMode="decimal"
              value={form.goalPercent}
              onChange={(e) =>
                setForm({ ...form, goalPercent: e.target.value })
              }
              data-testid="input-dbe-percent"
            />
          </div>
          <div>
            <Label>Goal $</Label>
            <Input
              inputMode="decimal"
              value={form.goalDollars}
              onChange={(e) =>
                setForm({ ...form, goalDollars: e.target.value })
              }
              data-testid="input-dbe-dollars"
            />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            data-testid="input-dbe-notes"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            data-testid="button-dbe-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mut.isPending || !projectId}
            data-testid="button-dbe-save"
          >
            {mut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : existing ? (
              "Update Goal"
            ) : (
              "Save Goal"
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
