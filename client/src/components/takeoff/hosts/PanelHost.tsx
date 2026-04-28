import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TakeoffSidebar } from "../TakeoffSidebar";
import { TakeoffDialogs } from "../TakeoffDialogs";
import { TakeoffVersionHistory } from "../TakeoffVersionHistory";
import { TakeoffSheetCompareDialog } from "../TakeoffSheetCompareDialog";
import { PlanScaleModal } from "../PlanScaleModal";
import TakeoffCrossModulePanel from "../TakeoffCrossModulePanel";
import { usePanelContext } from "./TakeoffWorkspaceContext";

/** Right-side panel host. Owns the version history dialog, the main
 *  sidebar, the cross-module overlay, the dialogs aggregator, the
 *  compare-revisions dialog, the scale modal, and the bid-package
 *  export dialog. Pure view layer — every wrapped component receives
 *  pre-built props from `PanelContextSlice`. */
function PanelHostInner() {
  const ctx = usePanelContext();
  return (
    <>
      <TakeoffVersionHistory {...ctx.versionHistory} />
      <TakeoffSidebar {...ctx.sidebar} />
      {ctx.crossModulePanel.visible && (
        <div
          className={cn(
            "absolute top-0 right-0 h-full w-full sm:w-[340px] max-w-full overflow-y-auto border-l bg-background shadow-2xl z-30 transition-opacity",
            ctx.crossModulePanel.isDrawing && !ctx.crossModulePanel.isMobile && "opacity-20 hover:opacity-100"
          )}
          data-testid="panel-cross-module-overlay"
        >
          <TakeoffCrossModulePanel {...ctx.crossModulePanel.props} />
        </div>
      )}
      <TakeoffDialogs {...ctx.dialogs} />
      {ctx.compareDialog && <TakeoffSheetCompareDialog {...ctx.compareDialog} />}
      <PlanScaleModal {...ctx.scaleModal} />
      <Dialog open={ctx.bidPackage.open} onOpenChange={ctx.bidPackage.setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Bid Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Trade / Scope</label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded-md text-sm bg-background"
              placeholder="e.g. Electrical, Plumbing, General"
              value={ctx.bidPackage.tradeScope}
              onChange={(e) => ctx.bidPackage.setTradeScope(e.target.value)}
              data-testid="input-bid-package-trade"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => ctx.bidPackage.setOpen(false)}
              data-testid="button-cancel-bid-package"
            >
              Cancel
            </Button>
            <Button onClick={ctx.bidPackage.onConfirm} data-testid="button-confirm-bid-package">
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const PanelHost = memo(PanelHostInner);
PanelHost.displayName = "PanelHost";
