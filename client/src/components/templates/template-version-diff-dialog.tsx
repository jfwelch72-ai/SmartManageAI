import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowRight, GitCompare } from "lucide-react";
import type { ProjectTemplate } from "@shared/schema";

type SnapshotTask = {
  refId: string;
  parentRefId: string | null;
  name: string;
  description?: string | null;
  wbsCode: string | null;
  outlineLevel?: number;
  durationDays: number | null;
  isMilestone: boolean;
  sortOrder: number;
  tradeType?: string | null;
  startOffsetDays?: number | null;
  endOffsetDays?: number | null;
  costCodeId?: string | null;
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
  tasks?: SnapshotTask[];
  dependencies?: SnapshotDep[];
  documentFolders?: SnapshotFolder[];
  scheduleOfValues?: SnapshotSov;
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

type DiffStatus = "added" | "removed" | "modified" | "unchanged";

const STATUS_STYLES: Record<DiffStatus, string> = {
  added:
    "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900",
  removed: "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900",
  modified:
    "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900",
  unchanged: "bg-background border-border",
};

const STATUS_BADGE: Record<DiffStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  added: { label: "Added", variant: "default" },
  removed: { label: "Removed", variant: "destructive" },
  modified: { label: "Modified", variant: "secondary" },
  unchanged: { label: "Unchanged", variant: "outline" },
};

function flattenFolders(folders: SnapshotFolder[] | undefined, prefix = ""): string[] {
  const out: string[] = [];
  for (const f of folders ?? []) {
    const path = prefix ? `${prefix} / ${f.name}` : f.name;
    out.push(path);
    if (f.children && f.children.length > 0) {
      out.push(...flattenFolders(f.children, path));
    }
  }
  return out;
}

function depKey(d: SnapshotDep): string {
  return `${d.predecessorRefId}__${d.successorRefId}`;
}

function sovKey(l: SnapshotSovLine, idx: number): string {
  if (l.itemNumber && l.itemNumber.trim()) return `num:${l.itemNumber.trim()}`;
  return `desc:${l.description}|${idx}`;
}

function tasksDiffer(a: SnapshotTask, b: SnapshotTask): boolean {
  return (
    a.name !== b.name ||
    a.parentRefId !== b.parentRefId ||
    a.wbsCode !== b.wbsCode ||
    a.durationDays !== b.durationDays ||
    a.isMilestone !== b.isMilestone ||
    a.sortOrder !== b.sortOrder ||
    (a.startOffsetDays ?? null) !== (b.startOffsetDays ?? null) ||
    (a.endOffsetDays ?? null) !== (b.endOffsetDays ?? null) ||
    (a.tradeType ?? null) !== (b.tradeType ?? null)
  );
}

function depsDiffer(a: SnapshotDep, b: SnapshotDep): boolean {
  return a.dependencyType !== b.dependencyType || a.lagDays !== b.lagDays;
}

function sovDiffer(a: SnapshotSovLine, b: SnapshotSovLine): boolean {
  return (
    a.description !== b.description ||
    (a.itemNumber ?? null) !== (b.itemNumber ?? null) ||
    (a.costCode ?? null) !== (b.costCode ?? null) ||
    (a.scheduledValue ?? null) !== (b.scheduledValue ?? null) ||
    a.sortOrder !== b.sortOrder
  );
}

function diffByKey<T>(
  aItems: T[],
  bItems: T[],
  keyOf: (t: T, i: number) => string,
  differ: (a: T, b: T) => boolean,
): Array<{ key: string; status: DiffStatus; a: T | null; b: T | null }> {
  const aMap = new Map<string, T>();
  aItems.forEach((t, i) => aMap.set(keyOf(t, i), t));
  const bMap = new Map<string, T>();
  bItems.forEach((t, i) => bMap.set(keyOf(t, i), t));
  const keys = new Set<string>([...aMap.keys(), ...bMap.keys()]);
  const rows: Array<{ key: string; status: DiffStatus; a: T | null; b: T | null }> = [];
  for (const key of keys) {
    const a = aMap.get(key) ?? null;
    const b = bMap.get(key) ?? null;
    let status: DiffStatus;
    if (a && !b) status = "removed";
    else if (!a && b) status = "added";
    else if (a && b && differ(a, b)) status = "modified";
    else status = "unchanged";
    rows.push({ key, status, a, b });
  }
  return rows;
}

function formatTask(t: SnapshotTask | null): JSX.Element {
  if (!t) return <span className="text-muted-foreground italic">—</span>;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 flex-wrap">
        {t.wbsCode && (
          <span className="text-xs text-muted-foreground">{t.wbsCode}</span>
        )}
        <span className="font-medium">{t.name}</span>
        {t.isMilestone && (
          <Badge variant="outline" className="text-[10px] py-0 px-1">
            milestone
          </Badge>
        )}
      </div>
      <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
        <span>ref: {t.refId}</span>
        {t.durationDays !== null && t.durationDays !== undefined && (
          <span>{t.durationDays}d</span>
        )}
        {t.parentRefId && <span>parent: {t.parentRefId}</span>}
        {t.startOffsetDays !== null && t.startOffsetDays !== undefined && (
          <span>start +{t.startOffsetDays}d</span>
        )}
      </div>
    </div>
  );
}

function formatDep(d: SnapshotDep | null, taskMap: Map<string, SnapshotTask>): JSX.Element {
  if (!d) return <span className="text-muted-foreground italic">—</span>;
  const pred = taskMap.get(d.predecessorRefId);
  const succ = taskMap.get(d.successorRefId);
  return (
    <div className="space-y-0.5">
      <div className="text-sm flex items-center gap-1 flex-wrap">
        <span className="truncate">{pred?.name ?? d.predecessorRefId}</span>
        <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground" />
        <span className="truncate">{succ?.name ?? d.successorRefId}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {d.dependencyType}
        {d.lagDays ? ` ${d.lagDays > 0 ? "+" : ""}${d.lagDays}d` : ""}
      </div>
    </div>
  );
}

function formatFolder(name: string | null): JSX.Element {
  if (!name) return <span className="text-muted-foreground italic">—</span>;
  return <span className="text-sm">{name}</span>;
}

function formatSov(l: SnapshotSovLine | null): JSX.Element {
  if (!l) return <span className="text-muted-foreground italic">—</span>;
  return (
    <div className="space-y-0.5">
      <div className="text-sm">
        {l.itemNumber && (
          <span className="text-muted-foreground mr-1">{l.itemNumber}</span>
        )}
        {l.description}
      </div>
      <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
        {l.costCode && <span>cc: {l.costCode}</span>}
        {l.scheduledValue && <span>${l.scheduledValue}</span>}
      </div>
    </div>
  );
}

function DiffSection<T>({
  rows,
  renderItem,
  emptyText,
  testId,
}: {
  rows: Array<{ key: string; status: DiffStatus; a: T | null; b: T | null }>;
  renderItem: (item: T | null) => JSX.Element;
  emptyText: string;
  testId: string;
}) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const visibleRows = useMemo(
    () => (showUnchanged ? rows : rows.filter((r) => r.status !== "unchanged")),
    [rows, showUnchanged],
  );
  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, modified: 0, unchanged: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="default" data-testid={`${testId}-count-added`}>
          +{counts.added} added
        </Badge>
        <Badge variant="destructive" data-testid={`${testId}-count-removed`}>
          −{counts.removed} removed
        </Badge>
        <Badge variant="secondary" data-testid={`${testId}-count-modified`}>
          ~{counts.modified} modified
        </Badge>
        <Badge variant="outline" data-testid={`${testId}-count-unchanged`}>
          {counts.unchanged} unchanged
        </Badge>
        <label className="ml-auto flex items-center gap-1 text-muted-foreground">
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)}
            data-testid={`${testId}-toggle-unchanged`}
          />
          Show unchanged
        </label>
      </div>
      {visibleRows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[100px_1fr_1fr] gap-2 text-xs font-semibold text-muted-foreground px-2">
            <div>Status</div>
            <div>Version A</div>
            <div>Version B</div>
          </div>
          {visibleRows.map((r) => (
            <div
              key={r.key}
              className={`grid grid-cols-[100px_1fr_1fr] gap-2 border rounded-md p-2 ${STATUS_STYLES[r.status]}`}
              data-testid={`${testId}-row-${r.key}`}
            >
              <div>
                <Badge variant={STATUS_BADGE[r.status].variant}>
                  {STATUS_BADGE[r.status].label}
                </Badge>
              </div>
              <div>{renderItem(r.a)}</div>
              <div>{renderItem(r.b)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplateVersionDiffDialog({
  template,
  open,
  onOpenChange,
}: {
  template: ProjectTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detailQuery = useQuery<DetailResponse>({
    queryKey: ["/api/project-templates", template?.id],
    enabled: !!template && open,
  });

  const versions = useMemo(() => {
    const list = detailQuery.data?.versions ?? [];
    return [...list].sort((a, b) => b.version - a.version);
  }, [detailQuery.data?.versions]);

  const [versionAId, setVersionAId] = useState<string | null>(null);
  const [versionBId, setVersionBId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (versions.length >= 2) {
      setVersionAId(versions[1].id);
      setVersionBId(versions[0].id);
    } else if (versions.length === 1) {
      setVersionAId(versions[0].id);
      setVersionBId(versions[0].id);
    }
  }, [open, versions]);

  const versionA = versions.find((v) => v.id === versionAId) ?? null;
  const versionB = versions.find((v) => v.id === versionBId) ?? null;

  const taskRows = useMemo(() => {
    const a = versionA?.snapshot.tasks ?? [];
    const b = versionB?.snapshot.tasks ?? [];
    return diffByKey(a, b, (t) => t.refId, tasksDiffer);
  }, [versionA, versionB]);

  const depRows = useMemo(() => {
    const a = versionA?.snapshot.dependencies ?? [];
    const b = versionB?.snapshot.dependencies ?? [];
    return diffByKey(a, b, depKey, depsDiffer);
  }, [versionA, versionB]);

  const folderRows = useMemo(() => {
    const a = flattenFolders(versionA?.snapshot.documentFolders);
    const b = flattenFolders(versionB?.snapshot.documentFolders);
    return diffByKey(
      a,
      b,
      (n) => n,
      () => false,
    );
  }, [versionA, versionB]);

  const sovRows = useMemo(() => {
    const a = versionA?.snapshot.scheduleOfValues?.lineItems ?? [];
    const b = versionB?.snapshot.scheduleOfValues?.lineItems ?? [];
    return diffByKey(a, b, sovKey, sovDiffer);
  }, [versionA, versionB]);

  const taskMap = useMemo(() => {
    const map = new Map<string, SnapshotTask>();
    for (const t of versionA?.snapshot.tasks ?? []) map.set(t.refId, t);
    for (const t of versionB?.snapshot.tasks ?? []) map.set(t.refId, t);
    return map;
  }, [versionA, versionB]);

  const summary = useMemo(() => {
    const sum = (rows: Array<{ status: DiffStatus }>) =>
      rows.filter((r) => r.status !== "unchanged").length;
    return {
      tasks: sum(taskRows),
      deps: sum(depRows),
      folders: sum(folderRows),
      sov: sum(sovRows),
    };
  }, [taskRows, depRows, folderRows, sovRows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-6xl max-h-[90vh] flex flex-col"
        data-testid="dialog-version-diff"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="w-5 h-5" />
            Compare versions: {template?.name}
          </DialogTitle>
          <DialogDescription>
            Pick two versions to see what changed in tasks, dependencies,
            document folders, and Schedule of Values lines.
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading ? (
          <div
            className="py-12 text-center text-muted-foreground"
            data-testid="text-diff-loading"
          >
            Loading versions...
          </div>
        ) : detailQuery.isError ? (
          <div
            className="py-12 text-center text-destructive"
            data-testid="text-diff-error"
          >
            Could not load template versions. Please close this dialog and try
            again.
          </div>
        ) : versions.length < 2 ? (
          <div
            className="py-12 text-center text-muted-foreground"
            data-testid="text-diff-no-versions"
          >
            This template only has one version, so there is nothing to compare
            yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Version A (older)</label>
                <Select
                  value={versionAId ?? undefined}
                  onValueChange={setVersionAId}
                >
                  <SelectTrigger data-testid="select-diff-version-a">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem
                        key={v.id}
                        value={v.id}
                        data-testid={`option-diff-a-${v.id}`}
                      >
                        v{v.version}
                        {v.notes ? ` — ${v.notes}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Version B (newer)</label>
                <Select
                  value={versionBId ?? undefined}
                  onValueChange={setVersionBId}
                >
                  <SelectTrigger data-testid="select-diff-version-b">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem
                        key={v.id}
                        value={v.id}
                        data-testid={`option-diff-b-${v.id}`}
                      >
                        v{v.version}
                        {v.notes ? ` — ${v.notes}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {versionAId && versionBId && versionAId === versionBId && (
              <p
                className="text-xs text-amber-700 dark:text-amber-400"
                data-testid="text-diff-same-version-warning"
              >
                You're comparing a version against itself. Pick two different
                versions to see changes.
              </p>
            )}

            <Tabs defaultValue="tasks" className="flex-1 flex flex-col overflow-hidden mt-2">
              <TabsList className="self-start">
                <TabsTrigger value="tasks" data-testid="tab-diff-tasks">
                  Tasks ({summary.tasks})
                </TabsTrigger>
                <TabsTrigger value="deps" data-testid="tab-diff-deps">
                  Dependencies ({summary.deps})
                </TabsTrigger>
                <TabsTrigger value="folders" data-testid="tab-diff-folders">
                  Folders ({summary.folders})
                </TabsTrigger>
                <TabsTrigger value="sov" data-testid="tab-diff-sov">
                  SoV lines ({summary.sov})
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="tasks"
                className="flex-1 overflow-hidden mt-3"
              >
                <ScrollArea className="h-[55vh] pr-3">
                  <DiffSection
                    rows={taskRows}
                    renderItem={(t) => formatTask(t)}
                    emptyText="No task changes between these versions."
                    testId="diff-tasks"
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent
                value="deps"
                className="flex-1 overflow-hidden mt-3"
              >
                <ScrollArea className="h-[55vh] pr-3">
                  <DiffSection
                    rows={depRows}
                    renderItem={(d) => formatDep(d, taskMap)}
                    emptyText="No dependency changes between these versions."
                    testId="diff-deps"
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent
                value="folders"
                className="flex-1 overflow-hidden mt-3"
              >
                <ScrollArea className="h-[55vh] pr-3">
                  <DiffSection
                    rows={folderRows}
                    renderItem={(n) => formatFolder(n)}
                    emptyText="No folder changes between these versions."
                    testId="diff-folders"
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent
                value="sov"
                className="flex-1 overflow-hidden mt-3"
              >
                <ScrollArea className="h-[55vh] pr-3">
                  <DiffSection
                    rows={sovRows}
                    renderItem={(l) => formatSov(l)}
                    emptyText="No SoV line changes between these versions."
                    testId="diff-sov"
                  />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-diff-close"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
