import { useMemo, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Clock,
  FileText,
  Folder,
  Layers,
  Loader2,
  Pin,
  PinOff,
  Ruler,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBids, useProjects } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";
import {
  pinRecent,
  removeRecent,
  unpinRecent,
  useRecentTakeoffs,
  type RecentTakeoffEntry,
} from "@/lib/takeoff-recents";
import type { Bid } from "@shared/schema";
import type { ProjectWithNames } from "@/hooks/use-data";

const ACTIVE_BID_STATUSES = new Set([
  "DRAFT",
  "IN_PROGRESS",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "ACTIVE",
]);

// Task #2073 — Active project statuses are listed first so PMs/estimators
// see in-flight projects above completed/closed ones. Mirrors the
// ACTIVE_BID_STATUSES bias used for the bid list above.
const ACTIVE_PROJECT_STATUSES = new Set(["ACTIVE", "PLANNING", "BID"]);

const RECENTS_LIMIT = 6;

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export default function TakeoffIndexPage() {
  const { data: bids = [], isLoading: bidsLoading } = useBids();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { user } = useAuth();
  const recents = useRecentTakeoffs(user?.id, RECENTS_LIMIT);
  const [search, setSearch] = useState("");

  const isLoading = bidsLoading || projectsLoading;

  // Recents are stored locally so the entity name/code there can drift if
  // the user renames or removes a bid/project. Filter to the bids and
  // projects the user can still access and prefer the latest name from
  // the API (Task #2072 + Task #2073).
  const bidsByCode = useMemo(() => {
    const map = new Map<string, Bid>();
    for (const b of bids as Bid[]) {
      if (b.code) map.set(b.code, b);
    }
    return map;
  }, [bids]);

  const projectsByCode = useMemo(() => {
    const map = new Map<string, ProjectWithNames>();
    for (const p of projects as ProjectWithNames[]) {
      if (p.code) map.set(p.code, p);
    }
    return map;
  }, [projects]);

  const refreshEntry = (entry: RecentTakeoffEntry): RecentTakeoffEntry | null => {
    if (entry.kind === "bid") {
      const fresh = bidsByCode.get(entry.entityCode);
      if (!fresh) return null;
      return {
        ...entry,
        entityName: fresh.name ?? entry.entityName ?? null,
        entityCode: fresh.code,
      };
    }
    const fresh = projectsByCode.get(entry.entityCode);
    if (!fresh) return null;
    return {
      ...entry,
      entityName: fresh.name ?? entry.entityName ?? null,
      entityCode: fresh.code,
    };
  };

  const visiblePinned = useMemo(
    () => recents.pinned
      .map(refreshEntry)
      .filter((e): e is NonNullable<typeof e> => e !== null),
    [recents.pinned, bidsByCode, projectsByCode],
  );
  const visibleRecent = useMemo(
    () => recents.recent
      .map(refreshEntry)
      .filter((e): e is NonNullable<typeof e> => e !== null),
    [recents.recent, bidsByCode, projectsByCode],
  );
  const hasRecents = visiblePinned.length > 0 || visibleRecent.length > 0;

  const filteredBids = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...(bids as Bid[])].sort((a, b) => {
      const aActive = ACTIVE_BID_STATUSES.has(String(a.status)) ? 0 : 1;
      const bActive = ACTIVE_BID_STATUSES.has(String(b.status)) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
    if (!q) return sorted;
    return sorted.filter(
      (b) =>
        (b.name || "").toLowerCase().includes(q) ||
        (b.code || "").toLowerCase().includes(q) ||
        (b.clientName || "").toLowerCase().includes(q),
    );
  }, [bids, search]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...(projects as ProjectWithNames[])].sort((a, b) => {
      const aActive = ACTIVE_PROJECT_STATUSES.has(String(a.status)) ? 0 : 1;
      const bActive = ACTIVE_PROJECT_STATUSES.has(String(b.status)) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
    if (!q) return sorted;
    return sorted.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.clientName || "").toLowerCase().includes(q),
    );
  }, [projects, search]);

  const showEmptyState =
    !isLoading && filteredBids.length === 0 && filteredProjects.length === 0;

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6" data-testid="takeoff-index-page">
      <div className="flex items-start gap-4">
        <div className="rounded-md bg-primary/10 p-3 shrink-0">
          <Ruler className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-takeoff-index-title">
            Takeoff
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open a bid or project to launch its dedicated full-screen takeoff
            workspace — measure quantities, mark up plans, and calibrate scale.
          </p>
        </div>
      </div>

      {hasRecents && (
        <section className="space-y-4" data-testid="takeoff-index-recents">
          {visiblePinned.length > 0 && (
            <div className="space-y-2" data-testid="takeoff-index-pinned">
              <div className="flex items-center gap-2">
                <Pin className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  Pinned
                </h2>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {visiblePinned.map((entry) => (
                  <RecentCard
                    key={`pinned:${entry.kind}:${entry.entityId}:${entry.sheetId ?? "none"}`}
                    entry={entry}
                    isPinned
                    userId={user?.id ?? null}
                  />
                ))}
              </div>
            </div>
          )}
          {visibleRecent.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  Recent
                </h2>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {visibleRecent.map((entry) => (
                  <RecentCard
                    key={`recent:${entry.kind}:${entry.entityId}:${entry.sheetId ?? "none"}`}
                    entry={entry}
                    isPinned={false}
                    userId={user?.id ?? null}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bids and projects by name, code, or client..."
          className="pl-9 h-10"
          data-testid="input-takeoff-search"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16" data-testid="takeoff-index-loading">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : showEmptyState ? (
        <Card data-testid="takeoff-index-empty">
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <FileText className="w-12 h-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium">
                {search
                  ? "No bids or projects match your search."
                  : "No bids or projects yet."}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a bid or project first to start a takeoff.
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" data-testid="button-takeoff-go-to-bids">
                <Link href="/bids">Go to Bids</Link>
              </Button>
              <Button asChild variant="outline" data-testid="button-takeoff-go-to-projects">
                <Link href="/projects">Go to Projects</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {filteredBids.length > 0 && (
            <section
              className="space-y-2"
              data-testid="takeoff-index-bids-section"
            >
              <div className="flex items-center justify-between">
                <h2
                  className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                  data-testid="text-takeoff-bids-heading"
                >
                  Bids
                </h2>
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="text-takeoff-bids-count"
                >
                  {filteredBids.length}
                </span>
              </div>
              <div className="grid gap-2">
                {filteredBids.map((bid) => (
                  <Link
                    key={bid.id}
                    href={`/takeoff/${bid.code}`}
                    data-testid={`link-takeoff-bid-${bid.code}`}
                  >
                    <Card className="hover-elevate active-elevate-2 transition-colors cursor-pointer">
                      <CardContent className="flex items-center gap-3 p-4">
                        <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="font-medium truncate"
                              data-testid={`text-takeoff-bid-name-${bid.code}`}
                            >
                              {bid.name || bid.code}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-mono uppercase tracking-wide shrink-0"
                            >
                              {bid.code}
                            </Badge>
                            {bid.status && (
                              <Badge variant="secondary" className="text-[10px] shrink-0">
                                {bid.status}
                              </Badge>
                            )}
                          </div>
                          {bid.clientName && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {bid.clientName}
                            </p>
                          )}
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Task #2073 — Projects share the takeoff landing page so PMs and
              estimators can launch the full-screen workspace from the same
              entry point as bids. Each card deep-links to
              /takeoff/project/:projectCode. */}
          {filteredProjects.length > 0 && (
            <section
              className="space-y-2"
              data-testid="takeoff-index-projects-section"
            >
              <div className="flex items-center justify-between">
                <h2
                  className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                  data-testid="text-takeoff-projects-heading"
                >
                  Projects
                </h2>
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="text-takeoff-projects-count"
                >
                  {filteredProjects.length}
                </span>
              </div>
              <div className="grid gap-2">
                {filteredProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/takeoff/project/${project.code}`}
                    data-testid={`link-takeoff-project-${project.code}`}
                  >
                    <Card className="hover-elevate active-elevate-2 transition-colors cursor-pointer">
                      <CardContent className="flex items-center gap-3 p-4">
                        <Folder className="w-5 h-5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="font-medium truncate"
                              data-testid={`text-takeoff-project-name-${project.code}`}
                            >
                              {project.name || project.code}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] font-mono uppercase tracking-wide shrink-0"
                            >
                              {project.code}
                            </Badge>
                            {project.status && (
                              <Badge variant="secondary" className="text-[10px] shrink-0">
                                {project.status}
                              </Badge>
                            )}
                          </div>
                          {project.clientName && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {project.clientName}
                            </p>
                          )}
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

interface RecentCardProps {
  entry: RecentTakeoffEntry;
  isPinned: boolean;
  userId: string | null;
}

function RecentCard({ entry, isPinned, userId }: RecentCardProps) {
  const basePath = entry.kind === "project"
    ? `/takeoff/project/${entry.entityCode}`
    : `/takeoff/${entry.entityCode}`;
  const href = entry.sheetId
    ? `${basePath}?sheet=${encodeURIComponent(entry.sheetId)}`
    : basePath;
  const testKey = entry.sheetId
    ? `${entry.kind}-${entry.entityCode}-${entry.sheetId}`
    : `${entry.kind}-${entry.entityCode}`;
  const selector = {
    kind: entry.kind,
    entityId: entry.entityId,
    sheetId: entry.sheetId ?? null,
  };

  // Pin/remove buttons sit inside the <Link>, so we have to stop the click
  // from bubbling up and triggering navigation. Both actions are no-ops if
  // the user isn't signed in (storage is keyed by userId).
  const handleTogglePin = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return;
    if (isPinned) unpinRecent(userId, selector);
    else pinRecent(userId, selector);
  };
  const handleRemove = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return;
    removeRecent(userId, selector);
  };

  return (
    <Link href={href} data-testid={`link-takeoff-recent-${testKey}`}>
      <Card className="hover-elevate active-elevate-2 transition-colors cursor-pointer h-full">
        <CardContent className="flex items-start gap-3 p-3">
          <div className="rounded-md bg-muted/60 p-2 shrink-0">
            {entry.sheetId ? (
              <Layers className="w-4 h-4 text-muted-foreground" />
            ) : entry.kind === "project" ? (
              <Folder className="w-4 h-4 text-muted-foreground" />
            ) : (
              <FileText className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="font-medium truncate text-sm"
                data-testid={`text-takeoff-recent-title-${testKey}`}
              >
                {entry.sheetName
                  || (entry.sheetId
                    ? "Sheet"
                    : entry.entityName || entry.entityCode)}
              </span>
              <Badge
                variant="outline"
                className="text-[10px] font-mono uppercase tracking-wide shrink-0"
              >
                {entry.entityCode}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {entry.sheetId
                ? entry.entityName || entry.entityCode
                : entry.kind === "project"
                  ? "Project"
                  : "Bid"}
              <span className="mx-1.5">·</span>
              <span data-testid={`text-takeoff-recent-time-${testKey}`}>
                {formatRelativeTime(entry.openedAt)}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={handleTogglePin}
                  aria-label={isPinned ? "Unpin" : "Pin"}
                  data-testid={`button-takeoff-recent-${isPinned ? "unpin" : "pin"}-${testKey}`}
                >
                  {isPinned ? (
                    <PinOff className="w-3.5 h-3.5" />
                  ) : (
                    <Pin className="w-3.5 h-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isPinned ? "Unpin" : "Pin"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={handleRemove}
                  aria-label="Remove"
                  data-testid={`button-takeoff-recent-remove-${testKey}`}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove</TooltipContent>
            </Tooltip>
            <ArrowRight className="w-4 h-4 text-muted-foreground ml-0.5 mt-1.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
