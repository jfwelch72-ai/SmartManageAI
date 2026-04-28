import { memo } from "react";
import { useCanvasContext } from "./TakeoffWorkspaceContext";
import { CanvasStage } from "./CanvasStage";

/**
 * CanvasHost — owns the Konva `<Stage>` tree (PDF backdrop, drawing
 * overlay, measurements, markups, sheet links, AI overlays, gridlines,
 * issue pins, collab cursors). Reads the entire CanvasContextSlice and
 * renders `<CanvasStage>` so the orchestrator no longer holds the
 * 1,893-line Stage JSX or threads ~95 props by hand.
 */
function CanvasHostInner() {
  const slice = useCanvasContext();
  return <CanvasStage {...slice} />;
}

export const CanvasHost = memo(CanvasHostInner);
CanvasHost.displayName = "CanvasHost";
