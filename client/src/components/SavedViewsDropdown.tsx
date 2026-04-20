import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Bookmark, Plus, Trash2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface ProjectsFilterState {
  status: string;
  search: string;
  special: string | null;
}

export interface AppliedView {
  view: "table" | "kanban" | "calendar" | "map";
  filters: ProjectsFilterState;
}

interface SavedView {
  id: string;
  name: string;
  view: "table" | "kanban" | "calendar" | "map";
  filtersJson: string;
}

interface BuiltInView {
  id: string;
  name: string;
  apply: AppliedView;
}

const BUILT_IN_VIEWS: BuiltInView[] = [
  {
    id: "builtin-all",
    name: "All projects",
    apply: { view: "table", filters: { status: "ALL", search: "", special: null } },
  },
  {
    id: "builtin-active",
    name: "My active projects",
    apply: { view: "table", filters: { status: "ACTIVE", search: "", special: "myProjects" } },
  },
  {
    id: "builtin-bidding",
    name: "Bidding",
    apply: { view: "kanban", filters: { status: "BID", search: "", special: null } },
  },
  {
    id: "builtin-onhold",
    name: "On hold > 14 days",
    apply: { view: "table", filters: { status: "PLANNING", search: "", special: "onHoldStale14" } },
  },
];

interface Props {
  current: AppliedView;
  onApply: (view: AppliedView) => void;
}

export default function SavedViewsDropdown({ current, onApply }: Props) {
  const { toast } = useToast();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: savedViews = [] } = useQuery<SavedView[]>({
    queryKey: ["/api/saved-views", { viewKey: "projects" }],
    queryFn: async () => {
      const res = await fetch("/api/saved-views?viewKey=projects", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load saved views");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiRequest("POST", "/api/saved-views", {
        viewKey: "projects",
        name: data.name,
        view: current.view,
        filters: current.filters,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", { viewKey: "projects" }] });
      toast({ title: "View saved", description: `"${newName}" is now in your saved views.` });
      setShowSaveDialog(false);
      setNewName("");
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not save view";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-views/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-views", { viewKey: "projects" }] });
      toast({ title: "View removed" });
    },
  });

  const applySaved = (sv: SavedView) => {
    let filters: ProjectsFilterState = { status: "ALL", search: "", special: null };
    try {
      const parsed = JSON.parse(sv.filtersJson || "{}");
      filters = {
        status: parsed.status ?? "ALL",
        search: parsed.search ?? "",
        special: parsed.special ?? null,
      };
    } catch {}
    onApply({ view: sv.view, filters });
  };

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
        <DropdownMenuContent align="end" className="w-64" data-testid="menu-saved-views">
          <DropdownMenuLabel className="text-xs">Built-in</DropdownMenuLabel>
          {BUILT_IN_VIEWS.map((bv) => (
            <DropdownMenuItem
              key={bv.id}
              onClick={() => onApply(bv.apply)}
              data-testid={`saved-view-${bv.id}`}
            >
              {bv.name}
            </DropdownMenuItem>
          ))}
          {savedViews.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">Your views</DropdownMenuLabel>
              {savedViews.map((sv) => (
                <div key={sv.id} className="flex items-center justify-between pr-1">
                  <DropdownMenuItem
                    className="flex-1"
                    onClick={() => applySaved(sv)}
                    data-testid={`saved-view-${sv.id}`}
                  >
                    {sv.name}
                    <span className="ml-2 text-[10px] text-muted-foreground uppercase">{sv.view}</span>
                  </DropdownMenuItem>
                  <button
                    type="button"
                    className="p-1.5 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteMutation.mutate(sv.id); }}
                    title="Delete saved view"
                    data-testid={`delete-saved-view-${sv.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
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
          <div className="space-y-2 py-2">
            <Label htmlFor="saved-view-name">Name</Label>
            <Input
              id="saved-view-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. My active jobs"
              data-testid="input-saved-view-name"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Saves the {current.view} view with the current filters. Visible only to you.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)} data-testid="button-cancel-save-view">
              Cancel
            </Button>
            <Button
              onClick={() => newName.trim() && createMutation.mutate({ name: newName.trim() })}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-confirm-save-view"
            >
              {createMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
