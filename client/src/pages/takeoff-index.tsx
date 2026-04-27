import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, FileText, Folder, Loader2, Ruler, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useBids, useProjects } from "@/hooks/use-data";
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

export default function TakeoffIndexPage() {
  const { data: bids = [], isLoading: bidsLoading } = useBids();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const [search, setSearch] = useState("");

  const isLoading = bidsLoading || projectsLoading;

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
