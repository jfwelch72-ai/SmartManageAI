import { memo } from "react";
import { AlertTriangle, Check, GitCompare, History, Loader2, Lock, Ruler, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageThumbnailStrip } from "../PageThumbnailStrip";
import { TakeoffSheetCompareDialog } from "../TakeoffSheetCompareDialog";
import { CollabHost } from "./CollabHost";
import { SheetSelectorBar } from "./SheetSelectorBar";
import { useSheetContext } from "./TakeoffWorkspaceContext";

/** Sheet/version status banners stacked above the canvas. Pure
 *  view layer: every action is a callback supplied through
 *  `SheetContextSlice` so the orchestrator owns the side effects. */
function SheetHostInner() {
  const ctx = useSheetContext();
  return (
    <>
      {ctx.isViewingLockedVersion && (
        <div
          className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
          data-testid="banner-viewing-historical"
        >
          <Lock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Viewing historical version (read-only)</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7 px-3 text-xs"
            onClick={ctx.onReturnToDraft}
            data-testid="button-return-to-draft"
          >
            Return to current draft
          </Button>
        </div>
      )}
      {ctx.detectedScale && !ctx.hasCurrentSheetScale && (
        <div
          className="bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 px-4 py-2 flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200"
          data-testid="banner-detected-scale"
        >
          <Ruler className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <span>
            Detected scale: <strong>{ctx.detectedScale.label}</strong>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={ctx.onAcceptDetectedScale}
              data-testid="button-accept-detected-scale"
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30"
              onClick={ctx.onDismissDetectedScale}
              data-testid="button-reject-detected-scale"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
      {ctx.showStaleBanner && (
        <div
          className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
          data-testid="banner-stale-drawing-set"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span data-testid="text-stale-banner-message">
            This set has {ctx.staleCanvasItemCount}{" "}
            stale {ctx.staleCanvasItemCount === 1 ? "sheet" : "sheets"}.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 h-7 px-2 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            onClick={ctx.onRepinStaleCanvas}
            disabled={ctx.isRepinPending}
            data-testid="button-banner-repin-stale"
          >
            {ctx.isRepinPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5 mr-1" />
            )}
            Re-pin to latest
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            onClick={ctx.onDismissStaleBanner}
            data-testid="button-banner-dismiss-stale"
            aria-label="Dismiss stale set banner"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
      {ctx.scaleDrift.visible && (
        // Task #2320 — drift banner. We surface it above the existing
        // "this drawing has been updated" banner because, if both
        // fire, the calibration warning is the more dangerous of the
        // two: a wrong scale silently corrupts every measurement
        // until somebody notices.
        <div
          className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
          data-testid="banner-scale-drift"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span data-testid="text-scale-drift-message">
            Scale on this revision is unverified
            {ctx.scaleDrift.scaleLabel ? (
              <>
                {" "}— inherited <strong>{ctx.scaleDrift.scaleLabel}</strong> from previous revision
              </>
            ) : (
              <> — inherited from previous revision</>
            )}
            .
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={ctx.scaleDrift.onVerify}
              data-testid="button-banner-verify-scale"
            >
              Verify dimension
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
              onClick={ctx.scaleDrift.onRecalibrate}
              data-testid="button-banner-recalibrate"
            >
              <Ruler className="w-3.5 h-3.5 mr-1" /> Re-calibrate
            </Button>
            {/* Task #2325 — audit trail entry. Ghost button so it
                visually defers to the primary "Verify dimension" CTA
                while still being one click from the warning context. */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
              onClick={ctx.scaleDrift.onShowHistory}
              data-testid="button-banner-scale-history"
            >
              <History className="w-3.5 h-3.5 mr-1" /> History
            </Button>
          </div>
        </div>
      )}
      {ctx.currentSheetIsSuperseded && (
        <div
          className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"
          data-testid="banner-sheet-superseded"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>This drawing has been updated — some measurements may reference the old revision.</span>
          {ctx.hasCompareNewSheet && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 h-7 px-2"
              onClick={ctx.onOpenCompareDialog}
              data-testid="button-banner-compare"
            >
              <GitCompare className="w-3.5 h-3.5 mr-1" /> Compare Revisions
            </Button>
          )}
        </div>
      )}
      <SheetSelectorBar {...ctx.selectorBar} collabSlot={<CollabHost />} />
      {ctx.thumbnailStrip && (
        <div className="bg-card border-b shrink-0" data-testid="panel-thumbnail-strip">
          <PageThumbnailStrip {...ctx.thumbnailStrip} />
        </div>
      )}
      {ctx.compareDialog && <TakeoffSheetCompareDialog {...ctx.compareDialog} />}
    </>
  );
}

export const SheetHost = memo(SheetHostInner);
SheetHost.displayName = "SheetHost";
