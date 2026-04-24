/**
 * Task #1659 — Unified Plan Toolbar (PDF preview surface).
 *
 * Replaces the two parallel toolbars previously rendered above
 * `<PdfPreview />` in PlansTab — `<PinFilterChips />` (with the pin-mode
 * toggle and per-page count mode) plus `<PlanMarkupToolbar />` — with a
 * single coherent toolbar that visually groups Navigate, Mark Up, and
 * Pin clusters.
 *
 * The intent matches the muscle memory of Figma / Bluebeam / Photoshop:
 * the user can see at a glance what kind of mark they are about to make
 * and which group it belongs to. Spacebar-hold-to-pan is wired up by
 * `PlansTab` (see `spacePanActive`) and is surfaced here as a
 * Navigate-group hint so users know how to pan from any tool.
 *
 * Underlying drawing/pin logic is unchanged — this is a UI consolidation.
 */
import { Hand, Pin } from "lucide-react";
import PlanMarkupToolbar from "@/components/markups/PlanMarkupToolbar";
import { PinFilterChips, type PinFilter } from "@/components/PlanPinLayer";
import type { MarkupTool } from "@/components/markups/MarkupRenderer";
import { cn } from "@/lib/utils";

export interface UnifiedPlanToolbarProps {
  // Markup
  markupTool: MarkupTool | null;
  onChangeMarkupTool: (tool: MarkupTool | null) => void;
  markupColor: string;
  onChangeMarkupColor: (color: string) => void;
  markupThickness: number;
  onChangeMarkupThickness: (thickness: number) => void;
  // Pin
  pinFilter: PinFilter;
  onChangePinFilter: (filter: PinFilter) => void;
  pinModeActive: boolean;
  onTogglePinMode: () => void;
  pinCountMode: "open" | "all";
  onChangePinCountMode: (mode: "open" | "all") => void;
  // Optional cluster toggle (forwarded to PinFilterChips when provided).
  clusteringEnabled?: boolean;
  onToggleClustering?: () => void;
  // Navigate (informational — pan/zoom controls live inside PdfPreview)
  spacePanActive?: boolean;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
      {children}
    </span>
  );
}

function GroupDivider() {
  return <span className="mx-2 h-5 w-px bg-border shrink-0" />;
}

export default function UnifiedPlanToolbar({
  markupTool,
  onChangeMarkupTool,
  markupColor,
  onChangeMarkupColor,
  markupThickness,
  onChangeMarkupThickness,
  pinFilter,
  onChangePinFilter,
  pinModeActive,
  onTogglePinMode,
  pinCountMode,
  onChangePinCountMode,
  clusteringEnabled,
  onToggleClustering,
  spacePanActive,
}: UnifiedPlanToolbarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b bg-muted/10 shrink-0 overflow-x-auto"
      data-testid="unified-plan-toolbar"
    >
      {/* ── Navigate ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0" data-testid="toolbar-group-navigate">
        <GroupLabel>Navigate</GroupLabel>
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border",
            spacePanActive
              ? "bg-primary/10 border-primary text-primary font-medium"
              : "bg-card border-border text-muted-foreground",
          )}
          title="Hold Space to temporarily pan from any tool"
          data-testid="toolbar-pan-hint"
        >
          <Hand className="w-3 h-3" />
          <span>Hold</span>
          <kbd className="px-1 py-0 rounded border bg-background font-mono text-[9px] leading-none">
            Space
          </kbd>
          <span>to pan</span>
        </div>
      </div>

      <GroupDivider />

      {/* ── Mark Up ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 shrink-0" data-testid="toolbar-group-markup">
        <GroupLabel>Mark Up</GroupLabel>
        <PlanMarkupToolbar
          activeTool={markupTool}
          onChangeTool={onChangeMarkupTool}
          color={markupColor}
          onChangeColor={onChangeMarkupColor}
          thickness={markupThickness}
          onChangeThickness={onChangeMarkupThickness}
          showLabel={false}
          showSelect={true}
          className="border-0 bg-transparent px-0 py-0"
        />
      </div>

      <GroupDivider />

      {/* ── Pin ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0" data-testid="toolbar-group-pin">
        <GroupLabel>
          <span className="inline-flex items-center gap-1">
            <Pin className="w-3 h-3" />
            Pin
          </span>
        </GroupLabel>
        <PinFilterChips
          filter={pinFilter}
          onChange={onChangePinFilter}
          pinModeActive={pinModeActive}
          onTogglePinMode={onTogglePinMode}
          clusteringEnabled={clusteringEnabled}
          onToggleClustering={onToggleClustering}
        />
      </div>

      {/* ── Pin counts (right-aligned) ───────────────────────────── */}
      <div className="ml-auto flex items-center gap-1 text-xs shrink-0" data-testid="toolbar-pin-counts">
        <span className="text-muted-foreground">Counts:</span>
        <button
          type="button"
          onClick={() => onChangePinCountMode("open")}
          className={cn(
            "px-2 py-0.5 rounded border",
            pinCountMode === "open"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card hover:bg-accent border-border",
          )}
          data-testid="button-pin-count-mode-open"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => onChangePinCountMode("all")}
          className={cn(
            "px-2 py-0.5 rounded border",
            pinCountMode === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card hover:bg-accent border-border",
          )}
          data-testid="button-pin-count-mode-all"
        >
          All
        </button>
      </div>
    </div>
  );
}
