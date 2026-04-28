import { memo } from "react";
import { TakeoffToolbar } from "../TakeoffToolbar";
import { useRibbonContext } from "./TakeoffWorkspaceContext";

/** Top toolbar host. Pure view layer — every callback is pre-bound by
 *  the orchestrator and exposed through `RibbonContextSlice`. Wrapped in
 *  `memo` so an orchestrator state change confined to a non-ribbon slice
 *  cannot rerender the toolbar; the host only rerenders when its slice
 *  identity actually changes (per-slice `useMemo` guarantees that). */
function RibbonHostInner() {
  const ctx = useRibbonContext();
  return (
    <TakeoffToolbar
      activeTool={ctx.activeTool}
      onToolSelect={ctx.handleToolSelect}
      stageScale={ctx.stageScale}
      setStageScale={ctx.setStageScale}
      selectedMeasurementId={ctx.selectedMeasurementId}
      measurements={ctx.measurements}
      onDeleteMeasurement={(m) => ctx.deleteMeasurementMutation.mutate(m)}
      deletePending={ctx.deleteMeasurementMutation.isPending}
      takeoffHistory={ctx.takeoffHistory}
      snapEnabled={ctx.snapEnabled}
      setSnapEnabled={ctx.setSnapEnabled}
      orthoLock={ctx.orthoLock}
      setOrthoLock={ctx.setOrthoLock}
      onUpload={ctx.onUpload}
      aiPanelOpen={ctx.aiPanelOpen}
      setAiPanelOpen={ctx.setAiPanelOpen}
      mobileMeasurementsOpen={ctx.mobileMeasurementsOpen}
      setMobileMeasurementsOpen={ctx.setMobileMeasurementsOpen}
      isDrawing={ctx.isDrawing}
      drawingPoints={ctx.drawingPoints}
      isMobile={ctx.isMobile}
      markupColor={ctx.markupColor}
      setMarkupColor={ctx.setMarkupColor}
      markupThickness={ctx.markupThickness}
      setMarkupThickness={ctx.setMarkupThickness}
      onExportCurrentSheet={ctx.handleExportCurrentSheet}
      onExportAllSheets={ctx.handleExportAllSheets}
      onExportQuantityDelta={ctx.handleExportQuantityDelta}
      onExportBidPackage={ctx.handleExportBidPackage}
      onPrintSheet={ctx.handlePrintSheet}
      isOffline={ctx.isOffline}
      onShowShortcuts={ctx.onShowShortcuts}
      sheetRotation={ctx.sheetRotation}
      onRotateCW={ctx.onRotateCW}
      onRotateCCW={ctx.onRotateCCW}
      onRotate180={ctx.onRotate180}
      gridEnabled={ctx.gridEnabled}
      onToggleGrid={ctx.handleToggleGrid}
      isCalibrated={ctx.isCalibrated}
      onFitToPage={ctx.onFitToPage}
      showMeasurementLabels={ctx.showMeasurementLabels}
      onToggleMeasurementLabels={ctx.onToggleMeasurementLabels}
      showStructuralGridlines={ctx.showStructuralGridlines}
      onToggleStructuralGridlines={ctx.setShowStructuralGridlines}
      labeled={ctx.labeled}
    />
  );
}

export const RibbonHost = memo(RibbonHostInner);
RibbonHost.displayName = "RibbonHost";
