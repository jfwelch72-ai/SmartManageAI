import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Loader2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBids, useProjects } from "@/hooks/use-data";

interface StandaloneTakeoff {
  id: string;
  title: string;
  tradeType: string | null;
  clientName: string | null;
}

/**
 * Task #2550 — Standalone takeoff full workspace page.
 *
 * Mirrors `takeoff-workspace.tsx`'s bid/project shell but powers the
 * shared `<TakeoffWorkspace>` with a `{ type: "standalone" }` context
 * so the same drawing tools, calibration, AI, and export surface
 * work against `/api/takeoff/standalone/:id/...` endpoints.
 *
 * Reached from the standalone detail page via "Open workspace" or by
 * clicking a sheet row (which deep-links `?sheet=<id>`).
 */
function WorkspaceTagDialog({ takeoffId }: { takeoffId: string }) {
  const { data: bids = [] } = useBids();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [destKind, setDestKind] = useState<"bid" | "project">("bid");
  const [destId, setDestId] = useState("");

  const tagMutation = useMutation({
    mutationFn: async (body: { bidId?: string; projectId?: string }) => {
      const res = await apiRequest("POST", `/api/takeoff/standalone/${takeoffId}/tags`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Takeoff tagged", description: "This takeoff now appears in the destination's Suggested Takeoffs." });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/standalone", takeoffId, "tags"] });
      setOpen(false);
      setDestId("");
    },
    onError: () => toast({ title: "Tag failed", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1 px-2 sm:px-3 shrink-0" data-testid="button-tag-takeoff-workspace">
          <Tag className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tag</span>
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-tag-takeoff-workspace">
        <DialogHeader>
          <DialogTitle>Tag this takeoff</DialogTitle>
          <DialogDescription>
            Linking attaches the takeoff to a bid or project — it will appear in their Suggested Takeoffs and can be sent to their estimate.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Destination type</Label>
            <Select value={destKind} onValueChange={(v) => { setDestKind(v === "project" ? "project" : "bid"); setDestId(""); }}>
              <SelectTrigger data-testid="select-workspace-dest-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bid">Bid</SelectItem>
                <SelectItem value="project">Project</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{destKind === "bid" ? "Bid" : "Project"}</Label>
            <Select value={destId} onValueChange={setDestId}>
              <SelectTrigger data-testid="select-workspace-dest-id"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {(destKind === "bid" ? bids : projects).map((d) => {
                  const opt = d as { id: string; name?: string | null; code?: string | null };
                  return (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name || opt.code || opt.id}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => tagMutation.mutate(destKind === "bid" ? { bidId: destId } : { projectId: destId })}
            disabled={!destId || tagMutation.isPending}
            data-testid="button-confirm-tag-workspace"
          >
            {tagMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TakeoffStandaloneWorkspacePage() {
  const [, params] = useRoute("/takeoff/standalone/:id/workspace");
  const [location] = useLocation();
  const id = params?.id ?? "";

  const takeoffQuery = useQuery<StandaloneTakeoff>({
    queryKey: ["/api/takeoff/standalone", id],
    enabled: !!id,
  });

  const initialSheetId = useMemo(() => {
    const search = typeof window === "undefined" ? "" : window.location.search;
    if (!search) return null;
    const sheet = new URLSearchParams(search).get("sheet");
    return sheet && sheet.length > 0 ? sheet : null;
  }, [location]);

  // Persist the deep-linked sheet into the same sessionStorage slot the
  // workspace uses internally so the takeoff component picks it up on
  // mount without needing a controlled prop wired through this page.
  useEffect(() => {
    if (!id || !initialSheetId) return;
    try {
      sessionStorage.setItem(`takeoff-sheet-standalone-${id}`, initialSheetId);
    } catch {
      // sessionStorage may be unavailable.
    }
  }, [id, initialSheetId]);

  if (!id) {
    return (
      <div className="flex items-center justify-center h-full p-8" data-testid="standalone-workspace-missing-id">
        <p className="text-muted-foreground">No takeoff id in URL.</p>
      </div>
    );
  }

  if (takeoffQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="standalone-workspace-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const takeoff = takeoffQuery.data;
  if (!takeoff) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8" data-testid="standalone-workspace-not-found">
        <FileText className="h-12 w-12 text-muted-foreground/40" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">Takeoff not found</h2>
          <p className="text-sm text-muted-foreground">
            The standalone takeoff you tried to open doesn't exist or you don't have access.
          </p>
        </div>
        <Button asChild variant="outline" data-testid="button-back-to-takeoff-index">
          <Link href="/takeoff">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Takeoffs
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0" data-testid="standalone-workspace-page">
      <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 border-b bg-muted/20 shrink-0">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 gap-1 px-2 shrink-0"
          data-testid="button-back-to-standalone-detail"
        >
          <Link href={`/takeoff/standalone/${takeoff.id}`}>
            <ArrowLeft className="w-4 h-4" />
            Takeoff
          </Link>
        </Button>
        <div className="h-5 w-px bg-border shrink-0" />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:inline-flex" />
          <span
            className="font-semibold text-sm truncate min-w-0"
            data-testid="text-standalone-workspace-title"
          >
            {takeoff.title}
          </span>
          {takeoff.tradeType && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide shrink-0">
              {takeoff.tradeType}
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px] shrink-0 hidden sm:inline-flex">
            Standalone
          </Badge>
        </div>
        <WorkspaceTagDialog takeoffId={takeoff.id} />
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-8 gap-1 px-2 sm:px-3 shrink-0"
          data-testid="button-open-standalone-detail"
        >
          <Link href={`/takeoff/standalone/${takeoff.id}`}>
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Open Detail</span>
          </Link>
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <WidgetErrorBoundary fallbackTitle="Takeoff Workspace">
          <TakeoffWorkspace
            context={{
              type: "standalone",
              standaloneTakeoffId: takeoff.id,
              standaloneTitle: takeoff.title,
            }}
            fullscreenScaleModal
            unifiedRibbon
          />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
