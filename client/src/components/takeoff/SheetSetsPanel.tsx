/**
 * Task #2141 — Sheet Sets UI for the takeoff workspace.
 *
 * Backend (Task #2065) shipped CRUD + members + reorder + apply-scale
 * endpoints behind `/api/takeoff/sheet-sets` with no UI; this panel
 * is the first user-facing surface for it. Mounted alongside the
 * canvas via `PanelHost`, the panel:
 *
 *  • lists every set scoped to the current project / bid context,
 *  • lets users create / rename / delete sets,
 *  • shows an aggregated calibration scale per set ("Mixed" when the
 *    members disagree),
 *  • surfaces an "Active set" toggle that re-scopes the workspace's
 *    `[` / `]` navigation and unlocks the inline calibration drawer's
 *    "Apply to entire Sheet Set" checkbox,
 *  • accepts drag-from-thumbnail (`application/x-takeoff-sheet`) on
 *    each set row to add a sheet without opening the picker,
 *  • reorders members via drag-and-drop within the row list.
 *
 * The propagation toast surfaced by the workspace after an
 * "Apply to entire Sheet Set" calibration lives in the parent
 * (`TakeoffWorkspace`) — this component only talks to the CRUD/member
 * endpoints. Keeping the toast at the calibration-drawer level lets
 * the Undo affordance share the apply-scale snapshot it already has.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { TakeoffSheet, TakeoffSheetSet } from "@shared/schema";

/** MIME used by the page-thumbnail strip when a sheet is dragged into
 *  a set row. Exported so the strip can stay in sync without us
 *  re-defining the magic string in two places. */
export const TAKEOFF_SHEET_DRAG_MIME = "application/x-takeoff-sheet";

interface SheetSetMember {
  id: string;
  setId: string;
  sheetId: string;
  sortOrder: number;
}

interface SheetSetWithMembers extends TakeoffSheetSet {
  members: SheetSetMember[];
}

export interface SheetSetsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Scope: project takeoff vs. bid takeoff. Exactly one of
   *  `projectId` / `bidId` is non-null. */
  projectId: string | null;
  bidId: string | null;
  /** Loaded sheets visible in the workspace. Used as the source for
   *  the "Add sheets to set" picker AND for resolving member sheet
   *  names. The panel never re-queries the sheets list itself. */
  sheets: TakeoffSheet[];
  selectedSheet: string | null;
  onSelectSheet: (sheetId: string) => void;
  /** Active set state lives in the workspace because keyboard
   *  navigation (`[` / `]`) and the inline calibration drawer both
   *  read it. The panel just calls back when the user clicks the
   *  "Make active" toggle. */
  activeSetId: string | null;
  onSetActive: (setId: string | null) => void;
  /** Called when the user clicks the per-set scale chip — opens the
   *  inline calibration drawer pre-checked for "Apply to entire
   *  Sheet Set". */
  onCalibrateSet: (setId: string) => void;
  /** Multi-sheet selection (Shift+[ / Shift+]). Surfaced here as a
   *  visual highlight on member rows so the user can see what the
   *  next bulk action will affect. */
  multiSelection: Set<string>;
  onClearMultiSelection: () => void;
}

interface CreateSetForm {
  name: string;
  description: string;
}

const SCOPE_QUERY_KEY = "/api/takeoff/sheet-sets";

function buildScopeQueryKey(projectId: string | null, bidId: string | null) {
  const scope: { projectId?: string; bidId?: string } = {};
  if (bidId) scope.bidId = bidId;
  else if (projectId) scope.projectId = projectId;
  return [SCOPE_QUERY_KEY, scope] as const;
}

function buildDetailQueryKey(setId: string) {
  return [SCOPE_QUERY_KEY, setId] as const;
}

/** Pure helper: aggregate the calibration scale of a set's members.
 *  Returns `"none"` when no member has a scale, `"mixed"` when at
 *  least two members disagree, otherwise the shared scale (and an
 *  optional label preferred from the members). Pulled out for
 *  testability and to keep the JSX small. */
export function aggregateSetScale(
  members: SheetSetMember[],
  sheetById: Map<string, TakeoffSheet>,
): { kind: "none" } | { kind: "mixed" } | {
  kind: "uniform";
  scalePxPerFoot: number;
  scaleLabel: string | null;
} {
  const scaled = members
    .map((m) => sheetById.get(m.sheetId))
    .filter((s): s is TakeoffSheet => !!s)
    .filter((s) => typeof s.scalePxPerFoot === "number" && s.scalePxPerFoot! > 0);
  if (scaled.length === 0) return { kind: "none" };
  const first = scaled[0].scalePxPerFoot!;
  // Tolerate sub-px floating-point drift; sheets are stored as
  // doublePrecision so a round-trip through the API can introduce
  // a 1e-9 delta when the same number is re-applied.
  const allMatch = scaled.every(
    (s) => Math.abs(s.scalePxPerFoot! - first) < 1e-6,
  );
  if (!allMatch) return { kind: "mixed" };
  return {
    kind: "uniform",
    scalePxPerFoot: first,
    scaleLabel: scaled[0].scaleLabel ?? null,
  };
}

export function SheetSetsPanel(props: SheetSetsPanelProps) {
  const {
    open,
    onClose,
    projectId,
    bidId,
    sheets,
    selectedSheet,
    onSelectSheet,
    activeSetId,
    onSetActive,
    onCalibrateSet,
    multiSelection,
    onClearMultiSelection,
  } = props;
  const { toast } = useToast();

  const sheetById = useMemo(() => {
    const m = new Map<string, TakeoffSheet>();
    for (const s of sheets) m.set(s.id, s);
    return m;
  }, [sheets]);

  const scopeKey = buildScopeQueryKey(projectId, bidId);
  const scopeQs = bidId
    ? `?bidId=${encodeURIComponent(bidId)}`
    : projectId
      ? `?projectId=${encodeURIComponent(projectId)}`
      : "";
  const setsQuery = useQuery<TakeoffSheetSet[]>({
    queryKey: scopeKey,
    enabled: open && (!!projectId || !!bidId),
    queryFn: async () => {
      const res = await fetch(`/api/takeoff/sheet-sets${scopeQs}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load sheet sets (${res.status})`);
      return (await res.json()) as TakeoffSheetSet[];
    },
    staleTime: 10_000,
  });

  // Each row hydrates its own detail (members) on demand. This avoids
  // a single huge round-trip for hundreds of sets and keeps the cache
  // surgical so an apply-scale only invalidates the affected detail.
  const [expandedSetId, setExpandedSetId] = useState<string | null>(null);
  // Local override for "active set" so the toggle feels instant; the
  // actual workspace state still flows through `onSetActive`.
  const handleToggleActive = useCallback(
    (setId: string) => {
      onSetActive(activeSetId === setId ? null : setId);
    },
    [activeSetId, onSetActive],
  );

  const invalidateScope = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: scopeKey });
  }, [scopeKey]);
  const invalidateDetail = useCallback((setId: string) => {
    queryClient.invalidateQueries({ queryKey: buildDetailQueryKey(setId) });
  }, []);

  // ── Mutations ────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (form: CreateSetForm) => {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        ...(form.description.trim() && { description: form.description.trim() }),
        ...(projectId && !bidId ? { projectId } : {}),
        ...(bidId ? { bidId } : {}),
      };
      const res = await apiRequest("POST", "/api/takeoff/sheet-sets", body);
      return (await res.json()) as TakeoffSheetSet;
    },
    onSuccess: (created) => {
      invalidateScope();
      setExpandedSetId(created.id);
      toast({ title: `Created "${created.name}"` });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not create set",
        description: err.message,
        variant: "destructive",
      }),
  });

  const renameMutation = useMutation({
    mutationFn: async (input: { id: string; name: string; description: string | null }) => {
      const body: Record<string, unknown> = { name: input.name };
      if (input.description !== null) body.description = input.description;
      const res = await apiRequest("PATCH", `/api/takeoff/sheet-sets/${input.id}`, body);
      return (await res.json()) as TakeoffSheetSet;
    },
    onSuccess: () => {
      invalidateScope();
      toast({ title: "Set renamed" });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not rename set",
        description: err.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/takeoff/sheet-sets/${id}`);
      return id;
    },
    onSuccess: (id) => {
      invalidateScope();
      if (activeSetId === id) onSetActive(null);
      toast({ title: "Set deleted" });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not delete set",
        description: err.message,
        variant: "destructive",
      }),
  });

  const addMembersMutation = useMutation({
    mutationFn: async (input: { setId: string; sheetIds: string[] }) => {
      const res = await apiRequest(
        "POST",
        `/api/takeoff/sheet-sets/${input.setId}/members`,
        { sheetIds: input.sheetIds },
      );
      return (await res.json()) as { added: Array<{ sheetId: string; sortOrder: number }> };
    },
    onSuccess: (data, variables) => {
      invalidateDetail(variables.setId);
      invalidateScope();
      toast({
        title:
          data.added.length === 1
            ? "Sheet added to set"
            : `${data.added.length} sheets added to set`,
      });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not add sheets",
        description: err.message,
        variant: "destructive",
      }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (input: { setId: string; sheetId: string }) => {
      await apiRequest(
        "DELETE",
        `/api/takeoff/sheet-sets/${input.setId}/members/${input.sheetId}`,
      );
      return input;
    },
    onSuccess: (_, variables) => {
      invalidateDetail(variables.setId);
    },
    onError: (err: Error) =>
      toast({
        title: "Could not remove sheet",
        description: err.message,
        variant: "destructive",
      }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (input: {
      setId: string;
      members: Array<{ sheetId: string; sortOrder: number }>;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/takeoff/sheet-sets/${input.setId}/reorder`,
        { members: input.members },
      );
      return (await res.json()) as { updated: number };
    },
    onSuccess: (_, variables) => invalidateDetail(variables.setId),
    onError: (err: Error) =>
      toast({
        title: "Could not reorder sheets",
        description: err.message,
        variant: "destructive",
      }),
  });

  // ── Form / dialog state ──────────────────────────────────────────
  const [createForm, setCreateForm] = useState<CreateSetForm>({ name: "", description: "" });
  const [creating, setCreating] = useState(false);
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<TakeoffSheetSet | null>(null);
  const [pickerSetId, setPickerSetId] = useState<string | null>(null);
  const [pickerSelection, setPickerSelection] = useState<Set<string>>(new Set());

  if (!open) return null;
  if (!projectId && !bidId) return null;

  const sets = setsQuery.data ?? [];

  return (
    <div
      className="absolute top-0 right-0 h-full w-full sm:w-[380px] max-w-full overflow-hidden border-l bg-background shadow-2xl z-30 flex flex-col"
      data-testid="panel-sheet-sets"
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
          <h2 className="text-sm font-semibold truncate">Sheet Sets</h2>
          <Badge variant="outline" className="text-[10px]" data-testid="badge-sheet-sets-count">
            {sets.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          data-testid="button-close-sheet-sets"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {creating ? (
        <div className="border-b p-3 space-y-2 bg-muted/30" data-testid="form-create-sheet-set">
          <Label htmlFor="sheet-set-name" className="text-xs">
            Set name
          </Label>
          <Input
            id="sheet-set-name"
            data-testid="input-sheet-set-name"
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Architectural plans"
            className="h-8 text-sm"
            autoFocus
          />
          <Input
            data-testid="input-sheet-set-description"
            value={createForm.description}
            onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional description"
            className="h-8 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setCreateForm({ name: "", description: "" });
              }}
              data-testid="button-cancel-create-sheet-set"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!createForm.name.trim()) return;
                createMutation.mutate(createForm, {
                  onSuccess: () => {
                    setCreating(false);
                    setCreateForm({ name: "", description: "" });
                  },
                });
              }}
              disabled={!createForm.name.trim() || createMutation.isPending}
              data-testid="button-confirm-create-sheet-set"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 border-b shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating(true)}
            className="w-full"
            data-testid="button-new-sheet-set"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> New sheet set
          </Button>
        </div>
      )}

      {multiSelection.size > 0 && (
        <div
          className="px-3 py-1.5 border-b bg-primary/5 text-[11px] flex items-center justify-between"
          data-testid="text-multi-sheet-selection"
        >
          <span>
            {multiSelection.size} sheet{multiSelection.size === 1 ? "" : "s"} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={onClearMultiSelection}
            data-testid="button-clear-multi-sheet-selection"
          >
            Clear
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <ul className="p-2 space-y-1">
          {setsQuery.isLoading && (
            <li className="text-xs text-muted-foreground px-2 py-4 text-center">
              Loading sheet sets...
            </li>
          )}
          {!setsQuery.isLoading && sets.length === 0 && (
            <li
              className="text-xs text-muted-foreground px-2 py-6 text-center"
              data-testid="text-sheet-sets-empty"
            >
              No sheet sets yet. Create one to group sheets that share a
              calibration scale.
            </li>
          )}
          {sets.map((set) => (
            <SetRow
              key={set.id}
              set={set}
              sheets={sheets}
              sheetById={sheetById}
              expanded={expandedSetId === set.id}
              onToggleExpanded={() =>
                setExpandedSetId((cur) => (cur === set.id ? null : set.id))
              }
              isActive={activeSetId === set.id}
              onToggleActive={() => handleToggleActive(set.id)}
              onCalibrate={() => onCalibrateSet(set.id)}
              onRename={() => {
                setRenamingSetId(set.id);
                setRenameDraft(set.name);
              }}
              onDelete={() => setDeleteCandidate(set)}
              onAddSheets={() => {
                setPickerSetId(set.id);
                setPickerSelection(new Set());
              }}
              onRemoveMember={(sheetId) =>
                removeMemberMutation.mutate({ setId: set.id, sheetId })
              }
              onReorder={(members) =>
                reorderMutation.mutate({ setId: set.id, members })
              }
              onSelectSheet={onSelectSheet}
              selectedSheet={selectedSheet}
              multiSelection={multiSelection}
              onAddSheetIds={(sheetIds) =>
                addMembersMutation.mutate({ setId: set.id, sheetIds })
              }
              addPending={addMembersMutation.isPending}
            />
          ))}
        </ul>
      </ScrollArea>

      {/* Rename dialog */}
      <Dialog
        open={renamingSetId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRenamingSetId(null);
            setRenameDraft("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="dialog-rename-sheet-set">
          <DialogHeader>
            <DialogTitle>Rename sheet set</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            placeholder="Set name"
            data-testid="input-rename-sheet-set"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRenamingSetId(null)}
              data-testid="button-cancel-rename-sheet-set"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!renamingSetId || !renameDraft.trim()) return;
                renameMutation.mutate(
                  { id: renamingSetId, name: renameDraft.trim(), description: null },
                  {
                    onSuccess: () => {
                      setRenamingSetId(null);
                      setRenameDraft("");
                    },
                  },
                );
              }}
              disabled={!renameDraft.trim() || renameMutation.isPending}
              data-testid="button-confirm-rename-sheet-set"
            >
              {renameMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteCandidate !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteCandidate(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-sheet-set">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sheet set?</AlertDialogTitle>
            <AlertDialogDescription>
              The set "{deleteCandidate?.name}" will be removed. The sheets
              themselves remain untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-sheet-set">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteCandidate) {
                  deleteMutation.mutate(deleteCandidate.id, {
                    onSuccess: () => setDeleteCandidate(null),
                  });
                }
              }}
              data-testid="button-confirm-delete-sheet-set"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add-sheets picker */}
      <Dialog
        open={pickerSetId !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPickerSetId(null);
            setPickerSelection(new Set());
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md max-h-[80vh] flex flex-col"
          data-testid="dialog-add-sheets"
        >
          <DialogHeader>
            <DialogTitle>Add sheets to set</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 min-h-0">
            <ul className="space-y-1">
              {sheets.map((s) => {
                const checked = pickerSelection.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 rounded p-2 hover-elevate"
                    data-testid={`picker-sheet-${s.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setPickerSelection((cur) => {
                          const next = new Set(cur);
                          if (v) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        });
                      }}
                      data-testid={`checkbox-picker-sheet-${s.id}`}
                    />
                    <span className="text-sm truncate flex-1">
                      {s.sheetName || "Untitled sheet"}
                    </span>
                    {s.scalePxPerFoot ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPickerSetId(null)}
              data-testid="button-cancel-add-sheets"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!pickerSetId || pickerSelection.size === 0) return;
                addMembersMutation.mutate(
                  { setId: pickerSetId, sheetIds: Array.from(pickerSelection) },
                  {
                    onSuccess: () => {
                      setPickerSetId(null);
                      setPickerSelection(new Set());
                    },
                  },
                );
              }}
              disabled={pickerSelection.size === 0 || addMembersMutation.isPending}
              data-testid="button-confirm-add-sheets"
            >
              Add {pickerSelection.size > 0 ? `(${pickerSelection.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SetRowProps {
  set: TakeoffSheetSet;
  sheets: TakeoffSheet[];
  sheetById: Map<string, TakeoffSheet>;
  expanded: boolean;
  onToggleExpanded: () => void;
  isActive: boolean;
  onToggleActive: () => void;
  onCalibrate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddSheets: () => void;
  onRemoveMember: (sheetId: string) => void;
  onReorder: (members: Array<{ sheetId: string; sortOrder: number }>) => void;
  onSelectSheet: (sheetId: string) => void;
  selectedSheet: string | null;
  multiSelection: Set<string>;
  onAddSheetIds: (sheetIds: string[]) => void;
  addPending: boolean;
}

function SetRow(props: SetRowProps) {
  const {
    set,
    sheets,
    sheetById,
    expanded,
    onToggleExpanded,
    isActive,
    onToggleActive,
    onCalibrate,
    onRename,
    onDelete,
    onAddSheets,
    onRemoveMember,
    onReorder,
    onSelectSheet,
    selectedSheet,
    multiSelection,
    onAddSheetIds,
    addPending,
  } = props;
  const [dropActive, setDropActive] = useState(false);
  const [draggingSheetId, setDraggingSheetId] = useState<string | null>(null);

  const detailQuery = useQuery<SheetSetWithMembers>({
    queryKey: buildDetailQueryKey(set.id),
    enabled: expanded,
    queryFn: async () => {
      const res = await fetch(`/api/takeoff/sheet-sets/${set.id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load sheet set (${res.status})`);
      return (await res.json()) as SheetSetWithMembers;
    },
    staleTime: 5_000,
  });

  const members = detailQuery.data?.members ?? [];
  const scaleAggregate = useMemo(
    () => aggregateSetScale(members, sheetById),
    [members, sheetById],
  );

  const dragHasSheetMime = (e: React.DragEvent): boolean => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === TAKEOFF_SHEET_DRAG_MIME) return true;
    }
    return false;
  };

  const handleReorderDrop = useCallback(
    (sourceSheetId: string, targetSheetId: string) => {
      if (sourceSheetId === targetSheetId) return;
      const ordered = [...members].sort((a, b) => a.sortOrder - b.sortOrder);
      const sourceIdx = ordered.findIndex((m) => m.sheetId === sourceSheetId);
      const targetIdx = ordered.findIndex((m) => m.sheetId === targetSheetId);
      if (sourceIdx === -1 || targetIdx === -1) return;
      const [moved] = ordered.splice(sourceIdx, 1);
      ordered.splice(targetIdx, 0, moved);
      const next = ordered.map((m, i) => ({ sheetId: m.sheetId, sortOrder: i }));
      onReorder(next);
    },
    [members, onReorder],
  );

  return (
    <li
      className={cn(
        "rounded border bg-card",
        isActive && "border-primary ring-1 ring-primary/40",
        dropActive && "ring-2 ring-primary bg-primary/5",
      )}
      data-testid={`row-sheet-set-${set.id}`}
      data-active-set={isActive ? "true" : "false"}
      onDragOver={(e) => {
        if (!dragHasSheetMime(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!dragHasSheetMime(e)) return;
        // Only clear when the drag leaves the row itself, not just a
        // child element. relatedTarget is null when leaving the
        // window entirely.
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setDropActive(false);
      }}
      onDrop={(e) => {
        if (!dragHasSheetMime(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropActive(false);
        const raw = e.dataTransfer.getData(TAKEOFF_SHEET_DRAG_MIME);
        if (!raw) return;
        // The thumbnail strip serializes the dragged ID as a JSON
        // payload so a future change can attach metadata (e.g. drag
        // source) without breaking the contract.
        let sheetId: string | null = null;
        try {
          const parsed = JSON.parse(raw) as { sheetId?: unknown };
          if (typeof parsed.sheetId === "string") sheetId = parsed.sheetId;
        } catch {
          // Tolerate raw string IDs for legacy drag sources.
          sheetId = raw;
        }
        if (!sheetId) return;
        // Skip silently when the sheet is already a member — saves a
        // 4xx round-trip and matches the "Add sheets" picker behaviour
        // where duplicates aren't surfaced.
        if (members.some((m) => m.sheetId === sheetId)) return;
        onAddSheetIds([sheetId]);
      }}
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onToggleExpanded}
          data-testid={`button-toggle-expand-set-${set.id}`}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </Button>
        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={onToggleExpanded}
          data-testid={`button-set-name-${set.id}`}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: set.color || "#3b82f6" }}
            />
            <span className="text-sm font-medium truncate">{set.name}</span>
            {isActive && (
              <Badge variant="default" className="text-[9px] px-1 py-0 h-4 shrink-0">
                Active
              </Badge>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {expanded
              ? `${members.length} sheet${members.length === 1 ? "" : "s"}`
              : (set.description || `${set.color === "#3b82f6" ? "" : ""}`)}
          </div>
        </button>
        <button
          type="button"
          onClick={onCalibrate}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 hover:bg-muted",
            scaleAggregate.kind === "mixed" && "text-amber-600 border-amber-300",
            scaleAggregate.kind === "uniform" && "text-green-700 border-green-300",
            scaleAggregate.kind === "none" && "text-muted-foreground",
          )}
          data-testid={`button-set-scale-${set.id}`}
          title={
            scaleAggregate.kind === "mixed"
              ? "Members have different scales — click to set a single scale"
              : "Click to calibrate this set"
          }
        >
          {scaleAggregate.kind === "none" && "Not calibrated"}
          {scaleAggregate.kind === "mixed" && "Mixed"}
          {scaleAggregate.kind === "uniform" &&
            (scaleAggregate.scaleLabel
              ? scaleAggregate.scaleLabel
              : `${scaleAggregate.scalePxPerFoot.toFixed(1)} px/ft`)}
        </button>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          className="h-6 px-1.5 text-[10px] shrink-0"
          onClick={onToggleActive}
          data-testid={`button-toggle-active-set-${set.id}`}
        >
          {isActive ? "Active" : "Activate"}
        </Button>
      </div>

      {expanded && (
        <div className="border-t px-2 py-2 space-y-2" data-testid={`set-detail-${set.id}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Members
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px]"
                onClick={onAddSheets}
                disabled={addPending}
                data-testid={`button-add-sheets-${set.id}`}
              >
                <Plus className="h-3 w-3 mr-1" /> Add sheets
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={onRename}
                data-testid={`button-rename-set-${set.id}`}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-destructive"
                onClick={onDelete}
                data-testid={`button-delete-set-${set.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {detailQuery.isLoading && (
            <div className="text-[10px] text-muted-foreground py-2 text-center">
              Loading members...
            </div>
          )}
          {!detailQuery.isLoading && members.length === 0 && (
            <div
              className="text-[10px] text-muted-foreground py-3 text-center border border-dashed rounded"
              data-testid={`set-empty-${set.id}`}
            >
              Drop a sheet thumbnail here, or click "Add sheets".
            </div>
          )}
          <ul className="space-y-0.5">
            {[...members]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((m) => {
                const sheet = sheetById.get(m.sheetId);
                const isCurrent = selectedSheet === m.sheetId;
                const inMulti = multiSelection.has(m.sheetId);
                return (
                  <li
                    key={m.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggingSheetId(m.sheetId);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", m.sheetId);
                    }}
                    onDragEnd={() => setDraggingSheetId(null)}
                    onDragOver={(e) => {
                      if (!draggingSheetId || draggingSheetId === m.sheetId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      if (!draggingSheetId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      handleReorderDrop(draggingSheetId, m.sheetId);
                      setDraggingSheetId(null);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-1.5 py-1 text-xs cursor-pointer",
                      "hover-elevate",
                      isCurrent && "bg-primary/10",
                      inMulti && !isCurrent && "bg-primary/5 ring-1 ring-primary/30",
                    )}
                    onClick={() => onSelectSheet(m.sheetId)}
                    data-testid={`set-member-${set.id}-${m.sheetId}`}
                    data-current={isCurrent ? "true" : "false"}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    {sheet?.scalePxPerFoot ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                    )}
                    <span className="flex-1 truncate">
                      {sheet?.sheetName || `Sheet ${m.sheetId.slice(0, 6)}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 opacity-60 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveMember(m.sheetId);
                      }}
                      data-testid={`button-remove-member-${set.id}-${m.sheetId}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </li>
  );
}
