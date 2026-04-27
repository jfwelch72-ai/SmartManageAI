import { useCallback, useEffect, useMemo } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { useAuth } from "@/hooks/use-auth";
import { useBid, useProject } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { useTour } from "@/components/TourProvider";
import { recordRecent, type RecentTakeoffKind } from "@/lib/takeoff-recents";
import type { TakeoffSheet } from "@shared/schema";

const LABELED_TOOLBAR_KEY = (uid: string | undefined | null) =>
  uid ? `bid-plan-toolbar-labeled-${uid}` : null;

function readLabeledPref(uid: string | undefined | null): boolean {
  if (typeof window === "undefined") return false;
  const key = LABELED_TOOLBAR_KEY(uid);
  if (!key) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export default function TakeoffWorkspacePage() {
  // Task #2073 — Same component now powers both /takeoff/:bidCode (bid
  // context) and /takeoff/project/:projectCode (project context). The
  // project route is matched first in App.tsx so a literal "project"
  // segment is never treated as a bid code.
  const [isProjectRoute, projectParams] = useRoute("/takeoff/project/:projectCode");
  const [, bidParams] = useRoute("/takeoff/:bidCode");
  const [location] = useLocation();
  const projectCode = isProjectRoute ? projectParams?.projectCode || "" : "";
  const bidCode = !isProjectRoute ? bidParams?.bidCode || "" : "";
  const { user } = useAuth();
  const { toast } = useToast();
  const { startBidPlansTour, isBidPlansTourCompleted } = useTour();

  const bidQuery = useBid(bidCode);
  const projectQuery = useProject(projectCode);

  const isLoading = isProjectRoute ? projectQuery.isLoading : bidQuery.isLoading;
  const isError = isProjectRoute ? projectQuery.isError : bidQuery.isError;
  const bid = bidQuery.data;
  const project = projectQuery.data;

  const labeled = useMemo(() => readLabeledPref(user?.id), [user?.id]);

  // Pre-select sheet from query string (e.g. /takeoff/B-123?sheet=abc) so
  // deep links from the bid/project Plans tab land on the right sheet.
  const initialSheetId = useMemo(() => {
    const search = typeof window === "undefined"
      ? ""
      : window.location.search;
    if (!search) return null;
    const sheet = new URLSearchParams(search).get("sheet");
    return sheet && sheet.length > 0 ? sheet : null;
  }, [location]);

  // Persist the deep-linked sheet into the same sessionStorage slot the
  // workspace uses internally so the takeoff component picks it up on mount
  // without needing a controlled prop wired through this page.
  const contextEntityId = isProjectRoute ? project?.id : bid?.id;
  useEffect(() => {
    if (!contextEntityId || !initialSheetId) return;
    try {
      sessionStorage.setItem(`takeoff-sheet-${contextEntityId}`, initialSheetId);
    } catch {
      // sessionStorage may be unavailable (private mode, SSR, etc).
    }
  }, [contextEntityId, initialSheetId]);

  // Task #2072 — record the workspace open in the per-user "Recent" history
  // that powers the Takeoff landing page. We log a sheet-less entry as soon
  // as the bid or project loads (so even browsing without picking a sheet
  // shows up), and add sheet-specific entries via the `onSelectSheet`
  // callback below. Task #2073 extended this to also cover project
  // takeoffs, which use the same recents store with kind="project".
  const recentKind: RecentTakeoffKind | null = isProjectRoute
    ? project
      ? "project"
      : null
    : bid
      ? "bid"
      : null;
  const entityId = isProjectRoute ? project?.id ?? null : bid?.id ?? null;
  const entityCode = isProjectRoute ? project?.code ?? null : bid?.code ?? null;
  const entityName = isProjectRoute ? project?.name ?? null : bid?.name ?? null;

  useEffect(() => {
    if (!user?.id || !recentKind || !entityId || !entityCode) return;
    recordRecent(user.id, {
      kind: recentKind,
      entityId,
      entityCode,
      entityName,
      sheetId: null,
      sheetName: null,
    });
  }, [user?.id, recentKind, entityId, entityCode, entityName]);

  // Mirror the same query the takeoff workspace itself uses so we can read
  // the sheet name when recording a "Recent" entry. Cached, so this doesn't
  // trigger a second network request.
  const sheetsQueryKey = recentKind === "project"
    ? ["/api/projects", entityId, "takeoff", "sheets"]
    : ["/api/bids", entityId, "takeoff", "sheets"];
  const { data: sheetsData } = useQuery<TakeoffSheet[]>({
    queryKey: sheetsQueryKey,
    enabled: !!entityId,
  });

  const handleSelectSheet = useCallback(
    (sheetId: string | null) => {
      if (!user?.id || !recentKind || !entityId || !entityCode || !sheetId) return;
      const sheet = (sheetsData ?? []).find((s) => s.id === sheetId) ?? null;
      recordRecent(user.id, {
        kind: recentKind,
        entityId,
        entityCode,
        entityName,
        sheetId,
        sheetName: sheet?.sheetName ?? null,
      });
    },
    [user?.id, recentKind, entityId, entityCode, entityName, sheetsData],
  );

  // Capture the deep-linked sheet (?sheet=...) once the sheets list arrives,
  // since the workspace component initializes its internal selection from
  // sessionStorage without firing `onSelectSheet`.
  useEffect(() => {
    if (!user?.id || !recentKind || !entityId || !entityCode || !initialSheetId) return;
    if (!sheetsData || sheetsData.length === 0) return;
    const sheet = sheetsData.find((s) => s.id === initialSheetId);
    if (!sheet) return;
    recordRecent(user.id, {
      kind: recentKind,
      entityId,
      entityCode,
      entityName,
      sheetId: sheet.id,
      sheetName: sheet.sheetName ?? null,
    });
  }, [user?.id, recentKind, entityId, entityCode, entityName, initialSheetId, sheetsData]);

  // Auto-trigger the takeoff tour on first visit to the standalone bid
  // workspace (mirrors the behavior the bid Plans tab used to provide while
  // takeoff was embedded — Task #1696). 800ms delay gives `<TakeoffWorkspace>`
  // time to mount its toolbar so Joyride can anchor `button-tool-pan`.
  // Project context reuses the same tour since the toolbar UX is identical.
  useEffect(() => {
    if (!user?.id || !contextEntityId) return;
    if (isBidPlansTourCompleted) return;
    const timer = window.setTimeout(() => startBidPlansTour(), 800);
    return () => window.clearTimeout(timer);
  }, [user?.id, contextEntityId, isBidPlansTourCompleted, startBidPlansTour]);

  useEffect(() => {
    if (isError) {
      toast({
        title: isProjectRoute ? "Project not found" : "Bid not found",
        description: isProjectRoute
          ? `No project matched code ${projectCode}.`
          : `No bid matched code ${bidCode}.`,
        variant: "destructive",
      });
    }
  }, [isError, isProjectRoute, projectCode, bidCode, toast]);

  const code = isProjectRoute ? projectCode : bidCode;

  if (!code) {
    return (
      <div className="flex items-center justify-center h-full p-8" data-testid="takeoff-workspace-missing-code">
        <p className="text-muted-foreground">
          {isProjectRoute ? "No project code in URL." : "No bid code in URL."}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="takeoff-workspace-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isProjectRoute && !project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8" data-testid="takeoff-workspace-not-found">
        <Folder className="h-12 w-12 text-muted-foreground/40" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">Project not found</h2>
          <p className="text-sm text-muted-foreground">
            No project matched <code className="font-mono">{projectCode}</code>.
          </p>
        </div>
        <Button asChild variant="outline" data-testid="button-back-to-projects">
          <Link href="/projects">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Projects
          </Link>
        </Button>
      </div>
    );
  }

  if (!isProjectRoute && !bid) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8" data-testid="takeoff-workspace-not-found">
        <FileText className="h-12 w-12 text-muted-foreground/40" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">Bid not found</h2>
          <p className="text-sm text-muted-foreground">
            No bid matched <code className="font-mono">{bidCode}</code>.
          </p>
        </div>
        <Button asChild variant="outline" data-testid="button-back-to-bids">
          <Link href="/bids">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Bids
          </Link>
        </Button>
      </div>
    );
  }

  if (isProjectRoute && project) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0" data-testid="takeoff-workspace-page">
        <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/20 shrink-0">
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-8 gap-1"
            data-testid="button-back-to-project"
          >
            <Link href={`/projects/${project.code}`}>
              <ArrowLeft className="w-4 h-4" />
              Project
            </Link>
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="font-semibold text-sm truncate" data-testid="text-takeoff-project-title">
              {project.name || project.code}
            </span>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide font-mono shrink-0" data-testid="badge-takeoff-project-code">
              {project.code}
            </Badge>
            {project.status && (
              <Badge variant="secondary" className="text-[10px] shrink-0" data-testid="badge-takeoff-project-status">
                {project.status}
              </Badge>
            )}
          </div>
          <div className="flex-1" />
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            data-testid="button-open-project-detail"
          >
            <Link href={`/projects/${project.code}`}>
              <ExternalLink className="w-3.5 h-3.5" />
              Open Project Detail
            </Link>
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <WidgetErrorBoundary fallbackTitle="Takeoff Workspace">
            <TakeoffWorkspace
              context={{ type: "project", projectId: project.id, projectCode: project.code }}
              labeled={labeled}
              fullscreenScaleModal
              onSelectSheet={handleSelectSheet}
            />
          </WidgetErrorBoundary>
        </div>
      </div>
    );
  }

  // Bid context (default).
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0" data-testid="takeoff-workspace-page">
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/20 shrink-0">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 gap-1"
          data-testid="button-back-to-bid"
        >
          <Link href={`/bids/${bidCode}`}>
            <ArrowLeft className="w-4 h-4" />
            Bid
          </Link>
        </Button>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm truncate" data-testid="text-takeoff-bid-title">
            {bid!.name || bid!.code}
          </span>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide font-mono shrink-0" data-testid="badge-takeoff-bid-code">
            {bid!.code}
          </Badge>
          {bid!.status && (
            <Badge variant="secondary" className="text-[10px] shrink-0" data-testid="badge-takeoff-bid-status">
              {bid!.status}
            </Badge>
          )}
        </div>
        <div className="flex-1" />
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          data-testid="button-open-bid-detail"
        >
          <Link href={`/bids/${bidCode}`}>
            <ExternalLink className="w-3.5 h-3.5" />
            Open Bid Detail
          </Link>
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <WidgetErrorBoundary fallbackTitle="Takeoff Workspace">
          <TakeoffWorkspace
            context={{ type: "bid", bidId: bid!.id, bidCode: bid!.code }}
            labeled={labeled}
            fullscreenScaleModal
            onSelectSheet={handleSelectSheet}
          />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
