// Task #2139 — Tool Chest mount point
//
// Dedicated host for the left-side Tool Chest panel. Sourced via the
// shared panel slice (`PanelContextSlice.toolChest`) so the chest goes
// through the same context plumbing as every other panel — there's no
// raw component coupling between TakeoffWorkspace and ToolChestPanel.
//
// Why a separate host instead of slotting into PanelHost: the chest
// renders absolutely-positioned at top-left and must be scoped to the
// canvas-area container so it sits *below* the unified ribbon. PanelHost
// renders the right-side stack (sidebar, dialogs, AI panel, etc.) at the
// outer workspace level, where `top-0` aligns with the workspace top —
// the same coordinates would cover the ribbon. Splitting hosts by
// region keeps each one's positioning contract internally consistent.
import { memo } from "react";
import { ToolChestPanel } from "../ToolChestPanel";
import { usePanelContext } from "./TakeoffWorkspaceContext";

function ToolChestHostInner() {
  const ctx = usePanelContext();
  return <ToolChestPanel {...ctx.toolChest} />;
}

export const ToolChestHost = memo(ToolChestHostInner);
ToolChestHost.displayName = "ToolChestHost";
