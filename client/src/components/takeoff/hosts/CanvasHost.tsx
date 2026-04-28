import { memo } from "react";
import { useCanvasContext } from "./TakeoffWorkspaceContext";
import { CanvasStage } from "./CanvasStage";
import { CanvasViewport } from "./CanvasViewport";

/**
 * CanvasHost — owns the canvas surface (the `<div ref={containerRef}>`
 * with all DOM overlays) and the Konva `<Stage>` tree. Reads the
 * CanvasContextSlice and delegates rendering to `<CanvasViewport>`
 * (DOM overlays + container) with `<CanvasStage>` slotted in as the
 * Stage. This means the orchestrator no longer owns ~500 lines of
 * canvas-surface JSX or threads ~95 stage props by hand.
 */
function CanvasHostInner() {
  const { stage, viewport } = useCanvasContext();
  return <CanvasViewport {...viewport} stageSlot={<CanvasStage {...stage} />} />;
}

export const CanvasHost = memo(CanvasHostInner);
CanvasHost.displayName = "CanvasHost";
