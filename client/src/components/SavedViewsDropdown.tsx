import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bookmark, Plus, Trash2, ChevronDown, Users, Share2, Pencil, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

export type ViewType = "table" | "kanban" | "calendar" | "map";

export interface AppliedView<F = Record<string, any>> {
  view: ViewType;
  filters: F;
}

interface SavedView {
  id: string;
  userId: string;
  name: string;
  view: ViewType;
  filtersJson: string;
  isShared: boolean;
  creatorName: string | null;
  creatorInitials: string | null;
}

export interface BuiltInView<F = Record<string, any>> {
  id: string;
  name: string;
  apply: AppliedView<F>;
}

interface Props<F = Record<string, any>> {
  viewKey: string;
  current: AppliedView<F>;
  onApply: (view: AppliedView<F>) => void;
  builtInViews?: BuiltInView<F>[];
  defaultFilters: F;
  /**
   * Optional override for the REST endpoint used to list/create/update/delete
   * saved views. Defaults to the org-wide `/api/saved-views` collection (which
   * accepts `viewKey` as a query/body param). Pages with their own dedicated
   * saved-views table (e.g. My Work → `/api/me/work/views`) pass their base
   * path here. When overridden, requests omit the `viewKey` param entirely.
   */
  apiBasePath?: string;
}

export default function SavedViewsDropdown<F extends Record<string, any> = Record<string, any>>({
  viewKey,
  current,
  onApply,
  builtInViews = [],
  defaultFilters,
  apiBasePath,
}: Props<F>) {
  const usingDedicatedEndpoint = typeof apiBasePath === "string" && apiBasePath.length > 0;
  const basePath = usingDedicatedEndpoint ? apiBasePath! : "/api/saved-views";
  const listQueryKey = usingDedicatedEndpoint
    ? [basePath]
    : [basePath, { viewKey }];
  const listUrl = usingDedicatedEndpoint
    ? basePath
    : `${basePath}?viewKey=${encodeURIComponent(viewKey)}`;
  const { toast } = useToast();
  const { user } = useAuth();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [shareWithTeam, setShareWithTeam] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedView | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const currentUserId = user?.id;

  const { data: savedViews = [] } = useQuery<SavedView[]>({
    queryKey: listQueryKey,
    queryFn: async () => {
      const res = await fetch(listUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load saved views");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; isShared: boolean }) => {
      const body: Record<string, unknown> = {
        name: data.name,
        view: current.view,
        filters: current.filters,
        isShared: data.isShared,
      };
      if (!usingDedicatedEndpoint) body.viewKey = viewKey;
      const res = await apiRequest("POST", basePath, body);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast({
        title: "View saved",
        description: vars.isShared
          ? `"${vars.name}" is now shared with your team.`
          : `"${vars.name}" is now in your saved views.`,
      });
      setShowSaveDialog(false);
      setNewName("");
      setShareWithTeam(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not save view";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `${basePath}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast({ title: "View removed" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not remove view";
      toast({ title: "Remove failed", description: message, variant: "destructive" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `${basePath}/${id}`, { name });
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast({ title: "View renamed", description: `Renamed to "${vars.name}".` });
      setRenameTarget(null);
      setRenameValue("");
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not rename view";
      toast({ title: "Rename failed", description: message, variant: "destructive" });
    },
  });

  const updateFiltersMutation = useMutation({
    mutationFn: async (sv: SavedView) => {
      const res = await apiRequest("PATCH", `${basePath}/${sv.id}`, {
        view: current.view,
        filters: current.filters,
      });
      return res.json();
    },
    onSuccess: (_d, sv) => {
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast({
        title: "View updated",
        description: `"${sv.name}" now uses the current filters.`,
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not update view";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
  });

  const toggleShareMutation = useMutation({
    mutationFn: async ({ id, isShared }: { id: string; isShared: boolean }) => {
      const res = await apiRequest("PATCH", `${basePath}/${id}`, { isShared });
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast({ title: vars.isShared ? "Shared with team" : "Now private" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not update view";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
  });

  const applySaved = (sv: SavedView) => {
    let filters: F = { ...defaultFilters };
    try {
      const parsed = JSON.parse(sv.filtersJson || "{}");
      filters = { ...defaultFilters, ...parsed } as F;
    } catch {}
    onApply({ view: sv.view, filters });
  };

  const canModify = (sv: SavedView) => sv.userId === currentUserId || isAdmin;

  const personalViews = savedViews.filter((v) => !v.isShared && v.userId === currentUserId);
  const teamViews = savedViews.filter((v) => v.isShared);

  const renderRow = (sv: SavedView, testIdPrefix: string, showCreator: boolean) => (
    <div key={sv.id} className="flex items-center justify-between pr-1">
      <DropdownMenuItem
        className="flex-1"
        onClick={() => applySaved(sv)}
        data-testid={`${testIdPrefix}-${sv.id}`}
      >
        <span className="truncate">{sv.name}</span>
        {showCreator && (sv.creatorName || sv.creatorInitials) && (
          <span
            className="ml-2 text-[10px] text-muted-foreground"
            title={sv.creatorName ?? undefined}
            data-testid={`text-saved-view-creator-${sv.id}`}
          >
            · {sv.creatorName || sv.creatorInitials}
          </span>
        )}
        <span className="ml-2 text-[10px] text-muted-foreground uppercase">{sv.view}</span>
      </DropdownMenuItem>
      {canModify(sv) && (
        <>
          <button
            type="button"
            className="p-1.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setRenameTarget(sv);
              setRenameValue(sv.name);
            }}
            title="Rename saved view"
            data-testid={`rename-saved-view-${sv.id}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              updateFiltersMutation.mutate(sv);
            }}
            disabled={updateFiltersMutation.isPending}
            title="Update with current filters"
            data-testid={`update-saved-view-${sv.id}`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleShareMutation.mutate({ id: sv.id, isShared: !sv.isShared });
            }}
            title={sv.isShared ? "Make private" : "Share with team"}
            data-testid={`toggle-share-saved-view-${sv.id}`}
          >
            <Share2 className={`w-3.5 h-3.5 ${sv.isShared ? "text-primary" : ""}`} />
          </button>
          <button
            type="button"
            className="p-1.5 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteMutation.mutate(sv.id);
            }}
            title="Delete saved view"
            data-testid={`delete-saved-view-${sv.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-saved-views">
            <Bookmark className="w-4 h-4" />
            <span className="hidden sm:inline">Saved Views</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72" data-testid="menu-saved-views">
          {builtInViews.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs">Built-in</DropdownMenuLabel>
              {builtInViews.map((bv) => (
                <DropdownMenuItem
                  key={bv.id}
                  onClick={() => onApply(bv.apply)}
                  data-testid={`saved-view-${bv.id}`}
                >
                  {bv.name}
                </DropdownMenuItem>
              ))}
            </>
          )}
          {teamViews.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs flex items-center gap-1.5">
                <Users className="w-3 h-3" />
                Team views
              </DropdownMenuLabel>
              {teamViews.map((sv) => renderRow(sv, "team-saved-view", true))}
            </>
          )}
          {personalViews.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">Your views</DropdownMenuLabel>
              {personalViews.map((sv) => renderRow(sv, "saved-view", false))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowSaveDialog(true)}
            data-testid="button-save-current-view"
          >
            <Plus className="w-4 h-4 mr-2" />
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent data-testid="dialog-save-view">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="saved-view-name">Name</Label>
              <Input
                id="saved-view-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Q3 Active Jobs"
                data-testid="input-saved-view-name"
                autoFocus
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="saved-view-shared"
                checked={shareWithTeam}
                onCheckedChange={(v) => setShareWithTeam(v === true)}
                data-testid="checkbox-share-with-team"
              />
              <div className="space-y-0.5">
                <Label htmlFor="saved-view-shared" className="cursor-pointer">
                  Share with team
                </Label>
                <p className="text-xs text-muted-foreground">
                  {shareWithTeam
                    ? `Everyone in your organization will see this ${current.view} view under "Team views".`
                    : `Saves the ${current.view} view with the current filters. Visible only to you.`}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)} data-testid="button-cancel-save-view">
              Cancel
            </Button>
            <Button
              onClick={() =>
                newName.trim() &&
                createMutation.mutate({ name: newName.trim(), isShared: shareWithTeam })
              }
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-confirm-save-view"
            >
              {createMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent data-testid="dialog-rename-view">
          <DialogHeader>
            <DialogTitle>Rename saved view</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="rename-saved-view-name">Name</Label>
              <Input
                id="rename-saved-view-name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                data-testid="input-rename-saved-view"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameTarget(null);
                setRenameValue("");
              }}
              data-testid="button-cancel-rename-view"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const name = renameValue.trim();
                if (name && renameTarget && name !== renameTarget.name) {
                  renameMutation.mutate({ id: renameTarget.id, name });
                } else if (name === renameTarget?.name) {
                  setRenameTarget(null);
                  setRenameValue("");
                }
              }}
              disabled={!renameValue.trim() || renameMutation.isPending}
              data-testid="button-confirm-rename-view"
            >
              {renameMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
