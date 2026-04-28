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
import { PlanScaleModal } from "../PlanScaleModal";
import TakeoffCrossModulePanel from "../TakeoffCrossModulePanel";
import { IssueDetailPanel } from "../IssueDetailPanel";
import { TakeoffPropertiesPanel } from "../TakeoffPropertiesPanel";
// NOTE: the Tool Chest (Task #2139) renders via its own `ToolChestHost`
// mounted inside the canvas-area container — see ToolChestHost.tsx for
// why it can't share PanelHost's outer-workspace mount point. The
// chest's props still flow through `PanelContextSlice.toolChest`, so
// the panel-slice contract is unchanged.
import AiTakeoffPanel from "@/components/AiTakeoffPanel";
import { MeasurementTablePanel } from "./MeasurementTablePanel";
import { MarkupStylingPanel } from "./MarkupStylingPanel";
import { usePanelContext } from "./TakeoffWorkspaceContext";

/** Right-side / bottom panel host. Owns the version history dialog,
 *  the main sidebar, the cross-module overlay, the dialogs aggregator,
 *  the bid-package export dialog, the bottom measurement table, the
 *  issue detail panel, the AI takeoff panel container, the markup
 *  styling popover, and the measurement properties panel. Pure view
 *  layer — every wrapped component receives pre-built props from
 *  `PanelContextSlice`. NOTE: the workspace bottom bar (batch action +
 *  status) is rendered by the orchestrator itself, INSIDE the
 *  canvas-area flex-col container, because it relies on flex-flow
 *  height to size correctly below the flex-1 canvas surface — moving
 *  it here would break the layout. The orchestrator still pulls the
 *  bottom-bar props from `PanelContextSlice.bottomBar` so the contract
 *  remains panel-owned. */
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
      <MeasurementTablePanel {...ctx.measurementTable} />
      {ctx.issueDetail && <IssueDetailPanel {...ctx.issueDetail} />}
      {ctx.aiPanel?.visible && (
        <div
          className={cn(
            "absolute top-0 right-0 h-full w-full sm:w-80 max-w-full border-l bg-card shadow-2xl z-40 flex flex-col transition-opacity",
            ctx.aiPanel.isDrawing && !ctx.aiPanel.isMobile && "opacity-20 hover:opacity-100"
          )}
          data-testid="panel-ai-takeoff-overlay"
        >
          <AiTakeoffPanel {...ctx.aiPanel.props} />
        </div>
      )}
      <MarkupStylingPanel {...ctx.markupStylingPanel} />
      {ctx.propertiesPanel && <TakeoffPropertiesPanel {...ctx.propertiesPanel} />}
    </>
  );
}

export const PanelHost = memo(PanelHostInner);
PanelHost.displayName = "PanelHost";
