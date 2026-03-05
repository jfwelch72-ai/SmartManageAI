import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Star, Plus, X } from "lucide-react";
import { type WorkerData, StarRatingInput } from "./types";

export function EvalDialog({
  open,
  onOpenChange,
  userId,
  userRole,
  workerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userRole: string;
  workerId: string;
}) {
  const { toast } = useToast();
  const [reviewerName, setReviewerName] = useState("");
  const [reviewDate, setReviewDate] = useState(new Date().toISOString().split("T")[0]);
  const [overallRating, setOverallRating] = useState(0);
  const [productivityRating, setProductivityRating] = useState(0);
  const [qualityRating, setQualityRating] = useState(0);
  const [safetyRating, setSafetyRating] = useState(0);
  const [communicationRating, setCommunicationRating] = useState(0);
  const [leadershipRating, setLeadershipRating] = useState(0);
  const [notes, setNotes] = useState("");
  const [scheduleAdherence, setScheduleAdherence] = useState("");
  const [costControl, setCostControl] = useState("");
  const [subCoordination, setSubCoordination] = useState("");
  const [inspectionOutcomes, setInspectionOutcomes] = useState("");

  const resetForm = () => {
    setReviewerName("");
    setReviewDate(new Date().toISOString().split("T")[0]);
    setOverallRating(0);
    setProductivityRating(0);
    setQualityRating(0);
    setSafetyRating(0);
    setCommunicationRating(0);
    setLeadershipRating(0);
    setNotes("");
    setScheduleAdherence("");
    setCostControl("");
    setSubCoordination("");
    setInspectionOutcomes("");
  };

  const evalMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        userId,
        reviewDate,
        reviewerName,
        overallRating,
      };
      if (productivityRating > 0) body.productivityRating = productivityRating;
      if (qualityRating > 0) body.qualityRating = qualityRating;
      if (safetyRating > 0) body.safetyRating = safetyRating;
      if (communicationRating > 0) body.communicationRating = communicationRating;
      if (leadershipRating > 0) body.leadershipRating = leadershipRating;
      if (notes.trim()) body.notes = notes.trim();
      if (scheduleAdherence.trim()) body.scheduleAdherence = scheduleAdherence.trim();
      if (costControl.trim()) body.costControl = costControl.trim();
      if (subCoordination.trim()) body.subcontractorCoordination = subCoordination.trim();
      if (inspectionOutcomes.trim()) body.clientInspectionOutcomes = inspectionOutcomes.trim();
      return await apiRequest("POST", "/api/auth/performance-reviews", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      toast({ title: "Evaluation added successfully" });
      onOpenChange(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add evaluation", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Performance Evaluation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="eval-reviewer">Reviewer Name</Label>
            <Input
              id="eval-reviewer"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              placeholder="Enter reviewer name"
              data-testid="input-eval-reviewer"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eval-date">Review Date</Label>
            <Input
              id="eval-date"
              type="date"
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
              data-testid="input-eval-date"
            />
          </div>
          <StarRatingInput label="Overall Rating" value={overallRating} onChange={setOverallRating} />
          <StarRatingInput label="Productivity" value={productivityRating} onChange={setProductivityRating} />
          <StarRatingInput label="Quality" value={qualityRating} onChange={setQualityRating} />
          <StarRatingInput label="Safety" value={safetyRating} onChange={setSafetyRating} />
          <StarRatingInput label="Communication" value={communicationRating} onChange={setCommunicationRating} />
          <StarRatingInput label="Leadership" value={leadershipRating} onChange={setLeadershipRating} />
          <div className="space-y-2">
            <Label htmlFor="eval-notes">Notes (optional)</Label>
            <Textarea
              id="eval-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              className="resize-none"
              data-testid="textarea-eval-notes"
            />
          </div>
          {userRole === "SUPERINTENDENT" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="eval-schedule">Schedule Adherence</Label>
                <Input
                  id="eval-schedule"
                  value={scheduleAdherence}
                  onChange={(e) => setScheduleAdherence(e.target.value)}
                  placeholder="Schedule adherence notes"
                  data-testid="input-eval-schedule"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eval-cost">Cost Control</Label>
                <Input
                  id="eval-cost"
                  value={costControl}
                  onChange={(e) => setCostControl(e.target.value)}
                  placeholder="Cost control notes"
                  data-testid="input-eval-cost"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eval-sub-coord">Subcontractor Coordination</Label>
                <Input
                  id="eval-sub-coord"
                  value={subCoordination}
                  onChange={(e) => setSubCoordination(e.target.value)}
                  placeholder="Subcontractor coordination notes"
                  data-testid="input-eval-sub-coord"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eval-inspection">Client Inspection Outcomes</Label>
                <Input
                  id="eval-inspection"
                  value={inspectionOutcomes}
                  onChange={(e) => setInspectionOutcomes(e.target.value)}
                  placeholder="Inspection outcomes"
                  data-testid="input-eval-inspection"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-eval"
          >
            Cancel
          </Button>
          <Button
            onClick={() => evalMutation.mutate()}
            disabled={!reviewerName.trim() || !reviewDate || overallRating === 0 || evalMutation.isPending}
            data-testid="button-submit-eval"
          >
            {evalMutation.isPending ? "Submitting..." : "Submit Evaluation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkillsDialog({
  open,
  onOpenChange,
  skills,
  workerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: WorkerData["skills"];
  workerId: string;
}) {
  const { toast } = useToast();
  const [newSkillName, setNewSkillName] = useState("");

  const addSkillMutation = useMutation({
    mutationFn: async (skillName: string) => {
      return await apiRequest("POST", `/api/auth/manage-workers/${workerId}/skills`, { skillName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      toast({ title: "Skill added" });
      setNewSkillName("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add skill", description: err.message, variant: "destructive" });
    },
  });

  const removeSkillMutation = useMutation({
    mutationFn: async (userSkillId: string) => {
      return await apiRequest("DELETE", `/api/auth/manage-workers/${workerId}/skills/${userSkillId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      toast({ title: "Skill removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove skill", description: err.message, variant: "destructive" });
    },
  });

  const updateSkillRatingMutation = useMutation({
    mutationFn: async ({ userSkillId, starRating }: { userSkillId: string; starRating: number }) => {
      return await apiRequest("PATCH", `/api/auth/manage-workers/${workerId}/skills/${userSkillId}/rating`, { starRating });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update rating", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Skills</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-end gap-2" data-testid="add-skill-form">
            <div className="flex-1 space-y-2">
              <Label htmlFor="new-skill-name">Add New Skill</Label>
              <Input
                id="new-skill-name"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                placeholder="Enter skill name"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newSkillName.trim()) {
                    addSkillMutation.mutate(newSkillName.trim());
                  }
                }}
                data-testid="input-new-skill"
              />
            </div>
            <Button
              size="sm"
              onClick={() => addSkillMutation.mutate(newSkillName.trim())}
              disabled={!newSkillName.trim() || addSkillMutation.isPending}
              data-testid="button-add-skill"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
          {skills.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-skills-dialog">
              No skills recorded yet. Add one above.
            </p>
          ) : (
            <div className="space-y-3 max-h-[40vh] overflow-y-auto">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between gap-2 py-1.5 border-b last:border-b-0"
                  data-testid={`skill-manage-row-${skill.id}`}
                >
                  <span className="text-sm truncate min-w-0 flex-1">{skill.skillName}</span>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }, (_, i) => {
                      const starVal = i + 1;
                      return (
                        <button
                          key={i}
                          type="button"
                          className="cursor-pointer p-0.5"
                          onClick={() => updateSkillRatingMutation.mutate({
                            userSkillId: skill.id,
                            starRating: skill.rating === starVal ? 0 : starVal,
                          })}
                          data-testid={`star-skill-${skill.id}-${starVal}`}
                        >
                          <Star
                            className={`h-4 w-4 ${
                              starVal <= skill.rating
                                ? "text-yellow-500 fill-yellow-500"
                                : "text-muted-foreground/40"
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSkillMutation.mutate(skill.id)}
                    disabled={removeSkillMutation.isPending}
                    data-testid={`button-remove-skill-${skill.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-skills"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignProjectDialog({
  open,
  onOpenChange,
  workerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workerId: string;
}) {
  const { toast } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  const { data: projectsResponse, isLoading: projectsLoading } = useQuery<{ data: Array<{ id: string; name: string; code: string; status: string }> }>({
    queryKey: ["/api/projects"],
    enabled: open,
  });
  const orgProjects = projectsResponse?.data;

  const assignProjectMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/auth/manage-workers/${workerId}/assign-project`, {
        projectId: selectedProjectId,
        notes: assignNotes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", workerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers"] });
      toast({ title: "Worker assigned to project successfully" });
      onOpenChange(false);
      setSelectedProjectId("");
      setAssignNotes("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to assign project", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Project</Label>
            {projectsLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger data-testid="select-assign-project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const activeProjects = (orgProjects || []).filter(
                      (p: any) => p.status !== "COMPLETED" && p.status !== "CANCELLED"
                    );
                    if (activeProjects.length === 0) {
                      return <SelectItem value="__none" disabled>No active projects available</SelectItem>;
                    }
                    return activeProjects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id} data-testid={`option-project-${p.id}`}>
                        {p.name}{p.code ? ` (${p.code})` : ""}
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="assign-notes">Notes (optional)</Label>
            <Textarea
              id="assign-notes"
              value={assignNotes}
              onChange={(e) => setAssignNotes(e.target.value)}
              placeholder="Add assignment notes..."
              data-testid="input-assign-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-assign"
          >
            Cancel
          </Button>
          <Button
            onClick={() => assignProjectMutation.mutate()}
            disabled={!selectedProjectId || assignProjectMutation.isPending || projectsLoading}
            data-testid="button-confirm-assign"
          >
            {assignProjectMutation.isPending ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
