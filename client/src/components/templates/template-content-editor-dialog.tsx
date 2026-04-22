import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { ProjectTemplate } from "@shared/schema";

type SnapshotTask = {
  refId: string;
  parentRefId: string | null;
  name: string;
  description: string | null;
  wbsCode: string | null;
  outlineLevel: number;
  durationDays: number | null;
  isMilestone: boolean;
  sortOrder: number;
  tradeType: string | null;
  startOffsetDays: number | null;
  endOffsetDays: number | null;
  costCodeId: string | null;
};

type SnapshotDep = {
  predecessorRefId: string;
  successorRefId: string;
  dependencyType: string;
  lagDays: number;
};

type SnapshotFolder = { name: string; children?: SnapshotFolder[] };

type SnapshotSovLine = {
  itemNumber: string | null;
  description: string;
  costCode: string | null;
  scheduledValue: string | null;
  sortOrder: number;
};

type SnapshotSov = { name: string; lineItems: SnapshotSovLine[] } | null;

type Snapshot = {
  schemaVersion: number;
  capturedAt: string;
  source: { projectId: string | null; projectCode: string | null };
  defaults: Record<string, unknown>;
  tasks: SnapshotTask[];
  dependencies: SnapshotDep[];
  documentFolders: SnapshotFolder[];
  distributionLists: unknown[];
  customFieldDefaults: Record<string, unknown>;
  costCodes: unknown[];
  scheduleOfValues: SnapshotSov;
  rfiCategories: string[];
  submittalCategories: string[];
};

type VersionRow = {
  id: string;
  templateId: string;
  version: number;
  notes: string | null;
  createdAt: string;
  snapshot: Snapshot;
};

type DetailResponse = {
  template: ProjectTemplate;
  versions: VersionRow[];
};

export function TemplateContentEditorDialog({
  template,
  open,
  onOpenChange,
}: {
  template: ProjectTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const detailQuery = useQuery<DetailResponse>({
    queryKey: ["/api/project-templates", template?.id],
    enabled: !!template && open,
  });

  const latestVersion = useMemo(() => {
    const versions = detailQuery.data?.versions ?? [];
    if (versions.length === 0) return null;
    return [...versions].sort((a, b) => b.version - a.version)[0];
  }, [detailQuery.data]);

  const [tasks, setTasks] = useState<SnapshotTask[]>([]);
  const [deps, setDeps] = useState<SnapshotDep[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [sovName, setSovName] = useState<string>("Schedule of Values");
  const [sovLines, setSovLines] = useState<SnapshotSovLine[]>([]);
  const [hasSov, setHasSov] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    if (!open || !latestVersion) return;
    const snap = latestVersion.snapshot;
    setTasks((snap.tasks ?? []).map((t) => ({ ...t })));
    setDeps((snap.dependencies ?? []).map((d) => ({ ...d })));
    setFolders((snap.documentFolders ?? []).map((f) => f.name));
    if (snap.scheduleOfValues) {
      setHasSov(true);
      setSovName(snap.scheduleOfValues.name ?? "Schedule of Values");
      setSovLines(snap.scheduleOfValues.lineItems.map((l) => ({ ...l })));
    } else {
      setHasSov(false);
      setSovName("Schedule of Values");
      setSovLines([]);
    }
    setNotes("");
  }, [latestVersion, open]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!template || !latestVersion) throw new Error("Template not loaded");
      const base = latestVersion.snapshot;
      const validRefIds = new Set(tasks.map((t) => t.refId));
      const cleanedDeps = deps.filter(
        (d) =>
          d.predecessorRefId &&
          d.successorRefId &&
          d.predecessorRefId !== d.successorRefId &&
          validRefIds.has(d.predecessorRefId) &&
          validRefIds.has(d.successorRefId),
      );
      const cleanedTasks = tasks.map((t, i) => ({
        ...t,
        sortOrder: i,
        parentRefId:
          t.parentRefId && validRefIds.has(t.parentRefId) ? t.parentRefId : null,
      }));
      const snapshot: Snapshot = {
        ...base,
        capturedAt: new Date().toISOString(),
        tasks: cleanedTasks,
        dependencies: cleanedDeps,
        documentFolders: folders
          .map((n) => n.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
        scheduleOfValues: hasSov
          ? {
              name: sovName.trim() || "Schedule of Values",
              lineItems: sovLines.map((l, i) => ({ ...l, sortOrder: i })),
            }
          : null,
      };
      const res = await apiRequest(
        "POST",
        `/api/project-templates/${template.id}/versions`,
        { snapshot, notes: notes.trim() || undefined },
      );
      return res.json();
    },
    onSuccess: (result: { template: ProjectTemplate; version: VersionRow }) => {
      toast({
        title: "New version saved",
        description: `Template is now at v${result.template.currentVersion}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/project-templates"] });
      if (template) {
        queryClient.invalidateQueries({
          queryKey: ["/api/project-templates", template.id],
        });
      }
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to save new version",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function addTask() {
    const nextNum = tasks.length + 1;
    let refId = `task_${nextNum}`;
    let attempt = nextNum;
    const existing = new Set(tasks.map((t) => t.refId));
    while (existing.has(refId)) {
      attempt += 1;
      refId = `task_${attempt}`;
    }
    setTasks((prev) => [
      ...prev,
      {
        refId,
        parentRefId: null,
        name: "New task",
        description: null,
        wbsCode: null,
        outlineLevel: 0,
        durationDays: 1,
        isMilestone: false,
        sortOrder: prev.length,
        tradeType: null,
        startOffsetDays: null,
        endOffsetDays: null,
        costCodeId: null,
      },
    ]);
  }

  function updateTask(i: number, patch: Partial<SnapshotTask>) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  function removeTask(i: number) {
    const removed = tasks[i];
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
    if (removed) {
      setDeps((prev) =>
        prev.filter(
          (d) =>
            d.predecessorRefId !== removed.refId &&
            d.successorRefId !== removed.refId,
        ),
      );
    }
  }

  function addDep() {
    if (tasks.length < 2) return;
    setDeps((prev) => [
      ...prev,
      {
        predecessorRefId: tasks[0].refId,
        successorRefId: tasks[1].refId,
        dependencyType: "FS",
        lagDays: 0,
      },
    ]);
  }

  function updateDep(i: number, patch: Partial<SnapshotDep>) {
    setDeps((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function removeDep(i: number) {
    setDeps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addSovLine() {
    setSovLines((prev) => [
      ...prev,
      {
        itemNumber: null,
        description: "New line item",
        costCode: null,
        scheduledValue: null,
        sortOrder: prev.length,
      },
    ]);
  }

  function updateSovLine(i: number, patch: Partial<SnapshotSovLine>) {
    setSovLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  function removeSovLine(i: number) {
    setSovLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  const isLoading = detailQuery.isLoading;
  const noVersion = !isLoading && !latestVersion;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-5xl max-h-[90vh] flex flex-col"
        data-testid="dialog-edit-template-content"
      >
        <DialogHeader>
          <DialogTitle>Edit content: {template?.name}</DialogTitle>
          <DialogDescription>
            Adjust tasks, dependencies, document folders, and the schedule of
            values. Saving creates a new version (v
            {(template?.currentVersion ?? 1) + 1}) and the previous version
            stays available for projects already using it.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground" data-testid="text-editor-loading">
            Loading template snapshot...
          </div>
        ) : noVersion ? (
          <div className="py-12 text-center text-muted-foreground" data-testid="text-editor-empty">
            This template has no version snapshot yet.
          </div>
        ) : (
          <Tabs defaultValue="tasks" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="self-start">
              <TabsTrigger value="tasks" data-testid="tab-tasks">
                Tasks ({tasks.length})
              </TabsTrigger>
              <TabsTrigger value="deps" data-testid="tab-deps">
                Dependencies ({deps.length})
              </TabsTrigger>
              <TabsTrigger value="folders" data-testid="tab-folders">
                Folders ({folders.length})
              </TabsTrigger>
              <TabsTrigger value="sov" data-testid="tab-sov">
                Schedule of Values
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="flex-1 overflow-hidden mt-3">
              <ScrollArea className="h-[55vh] pr-3">
                <div className="space-y-2">
                  {tasks.map((t, i) => (
                    <div
                      key={`${t.refId}-${i}`}
                      className="border rounded-md p-3 space-y-2"
                      data-testid={`row-task-${i}`}
                    >
                      <div className="flex items-start gap-2">
                        <Input
                          className="flex-1"
                          placeholder="Task name"
                          value={t.name}
                          onChange={(e) => updateTask(i, { name: e.target.value })}
                          data-testid={`input-task-name-${i}`}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeTask(i)}
                          data-testid={`button-remove-task-${i}`}
                          aria-label="Remove task"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground">
                            WBS code
                          </label>
                          <Input
                            value={t.wbsCode ?? ""}
                            onChange={(e) =>
                              updateTask(i, { wbsCode: e.target.value || null })
                            }
                            data-testid={`input-task-wbs-${i}`}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">
                            Duration (days)
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={t.durationDays ?? ""}
                            onChange={(e) =>
                              updateTask(i, {
                                durationDays:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                            data-testid={`input-task-duration-${i}`}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">
                            Start offset (days)
                          </label>
                          <Input
                            type="number"
                            value={t.startOffsetDays ?? ""}
                            onChange={(e) =>
                              updateTask(i, {
                                startOffsetDays:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                            data-testid={`input-task-start-${i}`}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">
                            Parent task
                          </label>
                          <Select
                            value={t.parentRefId ?? "__none__"}
                            onValueChange={(v) =>
                              updateTask(i, {
                                parentRefId: v === "__none__" ? null : v,
                              })
                            }
                          >
                            <SelectTrigger data-testid={`select-task-parent-${i}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— None —</SelectItem>
                              {tasks
                                .filter((other) => other.refId !== t.refId)
                                .map((other) => (
                                  <SelectItem key={other.refId} value={other.refId}>
                                    {other.name} ({other.refId})
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`milestone-${i}`}
                          checked={t.isMilestone}
                          onCheckedChange={(v) =>
                            updateTask(i, { isMilestone: !!v })
                          }
                          data-testid={`checkbox-task-milestone-${i}`}
                        />
                        <label htmlFor={`milestone-${i}`} className="text-sm">
                          Milestone
                        </label>
                        <span className="text-xs text-muted-foreground ml-auto">
                          ref: {t.refId}
                        </span>
                      </div>
                    </div>
                  ))}
                  {tasks.length === 0 && (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No tasks. Add one to get started.
                    </p>
                  )}
                </div>
              </ScrollArea>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTask}
                  data-testid="button-add-task"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add task
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="deps" className="flex-1 overflow-hidden mt-3">
              <ScrollArea className="h-[55vh] pr-3">
                <div className="space-y-2">
                  {deps.map((d, i) => (
                    <div
                      key={i}
                      className="border rounded-md p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end"
                      data-testid={`row-dep-${i}`}
                    >
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Predecessor
                        </label>
                        <Select
                          value={d.predecessorRefId}
                          onValueChange={(v) =>
                            updateDep(i, { predecessorRefId: v })
                          }
                        >
                          <SelectTrigger data-testid={`select-dep-pred-${i}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tasks.map((t) => (
                              <SelectItem key={t.refId} value={t.refId}>
                                {t.name} ({t.refId})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Successor
                        </label>
                        <Select
                          value={d.successorRefId}
                          onValueChange={(v) =>
                            updateDep(i, { successorRefId: v })
                          }
                        >
                          <SelectTrigger data-testid={`select-dep-succ-${i}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tasks.map((t) => (
                              <SelectItem key={t.refId} value={t.refId}>
                                {t.name} ({t.refId})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Type</label>
                        <Select
                          value={d.dependencyType}
                          onValueChange={(v) => updateDep(i, { dependencyType: v })}
                        >
                          <SelectTrigger data-testid={`select-dep-type-${i}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FS">FS — Finish to Start</SelectItem>
                            <SelectItem value="SS">SS — Start to Start</SelectItem>
                            <SelectItem value="FF">FF — Finish to Finish</SelectItem>
                            <SelectItem value="SF">SF — Start to Finish</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Lag (days)
                        </label>
                        <Input
                          type="number"
                          value={d.lagDays}
                          onChange={(e) =>
                            updateDep(i, { lagDays: Number(e.target.value) || 0 })
                          }
                          data-testid={`input-dep-lag-${i}`}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeDep(i)}
                        data-testid={`button-remove-dep-${i}`}
                        aria-label="Remove dependency"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {deps.length === 0 && (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No dependencies defined.
                    </p>
                  )}
                </div>
              </ScrollArea>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addDep}
                  disabled={tasks.length < 2}
                  data-testid="button-add-dep"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add dependency
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="folders" className="flex-1 overflow-hidden mt-3">
              <ScrollArea className="h-[55vh] pr-3">
                <div className="space-y-2">
                  {folders.map((name, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2"
                      data-testid={`row-folder-${i}`}
                    >
                      <Input
                        value={name}
                        onChange={(e) =>
                          setFolders((prev) =>
                            prev.map((n, idx) => (idx === i ? e.target.value : n)),
                          )
                        }
                        data-testid={`input-folder-${i}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setFolders((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        data-testid={`button-remove-folder-${i}`}
                        aria-label="Remove folder"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {folders.length === 0 && (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No document folders defined.
                    </p>
                  )}
                </div>
              </ScrollArea>
              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFolders((prev) => [...prev, "New folder"])}
                  data-testid="button-add-folder"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add folder
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="sov" className="flex-1 overflow-hidden mt-3 space-y-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="has-sov"
                  checked={hasSov}
                  onCheckedChange={(v) => setHasSov(!!v)}
                  data-testid="checkbox-has-sov"
                />
                <label htmlFor="has-sov" className="text-sm">
                  Include a Schedule of Values
                </label>
              </div>
              {hasSov && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      Schedule name
                    </label>
                    <Input
                      value={sovName}
                      onChange={(e) => setSovName(e.target.value)}
                      data-testid="input-sov-name"
                    />
                  </div>
                  <ScrollArea className="h-[40vh] pr-3">
                    <div className="space-y-2">
                      {sovLines.map((l, i) => (
                        <div
                          key={i}
                          className="border rounded-md p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end"
                          data-testid={`row-sov-${i}`}
                        >
                          <div>
                            <label className="text-xs text-muted-foreground">
                              Item #
                            </label>
                            <Input
                              value={l.itemNumber ?? ""}
                              onChange={(e) =>
                                updateSovLine(i, {
                                  itemNumber: e.target.value || null,
                                })
                              }
                              data-testid={`input-sov-item-${i}`}
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="text-xs text-muted-foreground">
                              Description
                            </label>
                            <Input
                              value={l.description}
                              onChange={(e) =>
                                updateSovLine(i, { description: e.target.value })
                              }
                              data-testid={`input-sov-desc-${i}`}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">
                              Cost code
                            </label>
                            <Input
                              value={l.costCode ?? ""}
                              onChange={(e) =>
                                updateSovLine(i, {
                                  costCode: e.target.value || null,
                                })
                              }
                              data-testid={`input-sov-code-${i}`}
                            />
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <label className="text-xs text-muted-foreground">
                                Scheduled value
                              </label>
                              <Input
                                type="number"
                                step="0.01"
                                value={l.scheduledValue ?? ""}
                                onChange={(e) =>
                                  updateSovLine(i, {
                                    scheduledValue: e.target.value || null,
                                  })
                                }
                                data-testid={`input-sov-value-${i}`}
                              />
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => removeSovLine(i)}
                              data-testid={`button-remove-sov-${i}`}
                              aria-label="Remove line"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {sovLines.length === 0 && (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                          No SoV line items.
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addSovLine}
                    data-testid="button-add-sov"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add line item
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}

        <div className="space-y-1 pt-2">
          <label className="text-sm font-medium">Version notes (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What changed in this version?"
            data-testid="input-version-notes"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending ||
              isLoading ||
              noVersion ||
              tasks.length === 0
            }
            data-testid="button-editor-save"
          >
            {saveMutation.isPending
              ? "Saving..."
              : `Save as v${(template?.currentVersion ?? 1) + 1}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
