import { useEffect, useMemo } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, ExternalLink, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";
import { useAuth } from "@/hooks/use-auth";
import { useBid } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { useTour } from "@/components/TourProvider";

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
  const [, params] = useRoute("/takeoff/:bidCode");
  const [location] = useLocation();
  const bidCode = params?.bidCode || "";
  const { user } = useAuth();
  const { toast } = useToast();
  const { startBidPlansTour, isBidPlansTourCompleted } = useTour();

  const { data: bid, isLoading, isError } = useBid(bidCode);

  const labeled = useMemo(() => readLabeledPref(user?.id), [user?.id]);

  // Pre-select sheet from query string (e.g. /takeoff/B-123?sheet=abc) so
  // deep links from the bid Plans tab land on the right sheet.
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
  useEffect(() => {
    if (!bid?.id || !initialSheetId) return;
    try {
      sessionStorage.setItem(`takeoff-sheet-${bid.id}`, initialSheetId);
    } catch {
      // sessionStorage may be unavailable (private mode, SSR, etc).
    }
  }, [bid?.id, initialSheetId]);

  // Auto-trigger the takeoff tour on first visit to the standalone workspace
  // (mirrors the behavior the bid Plans tab used to provide while takeoff was
  // embedded — Task #1696). 800ms delay gives `<TakeoffWorkspace>` time to
  // mount its toolbar so Joyride can anchor `button-tool-pan`.
  useEffect(() => {
    if (!user?.id || !bid?.id) return;
    if (isBidPlansTourCompleted) return;
    const timer = window.setTimeout(() => startBidPlansTour(), 800);
    return () => window.clearTimeout(timer);
  }, [user?.id, bid?.id, isBidPlansTourCompleted, startBidPlansTour]);

  useEffect(() => {
    if (isError) {
      toast({
        title: "Bid not found",
        description: `No bid matched code ${bidCode}.`,
        variant: "destructive",
      });
    }
  }, [isError, bidCode, toast]);

  if (!bidCode) {
    return (
      <div className="flex items-center justify-center h-full p-8" data-testid="takeoff-workspace-missing-code">
        <p className="text-muted-foreground">No bid code in URL.</p>
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

  if (!bid) {
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
            {bid.name || bid.code}
          </span>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide font-mono shrink-0" data-testid="badge-takeoff-bid-code">
            {bid.code}
          </Badge>
          {bid.status && (
            <Badge variant="secondary" className="text-[10px] shrink-0" data-testid="badge-takeoff-bid-status">
              {bid.status}
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
            context={{ type: "bid", bidId: bid.id, bidCode: bid.code }}
            labeled={labeled}
            fullscreenScaleModal
          />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
