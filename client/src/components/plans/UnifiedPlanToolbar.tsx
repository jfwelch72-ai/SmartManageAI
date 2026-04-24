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
 *
 * Task #1663 — Adds a per-user "Labeled toolbar" preference toggle plus a
 * "Replay tour" entry point in a small Settings menu at the right end of
 * the toolbar. Pin-count mode buttons and the pan hint also gain hover
 * tooltips so first-time users can discover what each control does.
 */
import { Hand, Pin, Settings2, Type, BookOpen } from "lucide-react";
import PlanMarkupToolbar from "@/components/markups/PlanMarkupToolbar";
import { PinFilterChips, type PinFilter } from "@/components/PlanPinLayer";
import type { MarkupTool } from "@/components/markups/MarkupRenderer";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  // Task #1663 — Labeled toolbar preference (icon-only ↔ icon+label).
  labeled?: boolean;
  onToggleLabeled?: () => void;
  // Task #1663 — Replay first-run plans tour from the settings menu.
  onReplayTour?: () => void;
  // Task #1705 — "Undo last group move" handler + availability flag.
  // Forwarded to <PlanMarkupToolbar /> so the Undo button lives next to
  // the markup tools. PlansTab owns the state and updates it whenever
  // <PlanMarkupLayer /> reports a fresh snapshot via `onUndoChange`.
  onUndoLastMove?: () => void;
  canUndoLastMove?: boolean;
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
  labeled = false,
  onToggleLabeled,
  onReplayTour,
  onUndoLastMove,
  canUndoLastMove = false,
}: UnifiedPlanToolbarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b bg-muted/10 shrink-0 overflow-x-auto"
      data-testid="unified-plan-toolbar"
    >
      {/* ── Navigate ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0" data-testid="toolbar-group-navigate">
        <GroupLabel>Navigate</GroupLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] border cursor-default",
                spacePanActive
                  ? "bg-primary/10 border-primary text-primary font-medium"
                  : "bg-card border-border text-muted-foreground",
              )}
              data-testid="toolbar-pan-hint"
            >
              <Hand className="w-3 h-3" />
              <span>Hold</span>
              <kbd className="px-1 py-0 rounded border bg-background font-mono text-[9px] leading-none">
                Space
              </kbd>
              <span>to pan</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span>Hold Space to temporarily pan from any tool. Release to restore your tool.</span>
          </TooltipContent>
        </Tooltip>
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
          labeled={labeled}
          onUndoLastMove={onUndoLastMove}
          canUndoLastMove={canUndoLastMove}
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
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent side="bottom"><span>Show only open pin counts on each page</span></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent side="bottom"><span>Show counts for all pins, including closed ones</span></TooltipContent>
        </Tooltip>

        {/* ── View settings (Labeled toolbar / Replay tour) ─────── */}
        {(onToggleLabeled || onReplayTour) && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 ml-1"
                    data-testid="button-plans-view-settings"
                    aria-label="Plans view settings"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom"><span>Plans view settings</span></TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Plans view</DropdownMenuLabel>
              {onToggleLabeled && (
                <DropdownMenuCheckboxItem
                  checked={!!labeled}
                  onCheckedChange={() => onToggleLabeled()}
                  data-testid="menu-item-labeled-toolbar"
                >
                  <Type className="w-3.5 h-3.5 mr-2" />
                  Labeled toolbar
                </DropdownMenuCheckboxItem>
              )}
              {onReplayTour && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onReplayTour()}
                    data-testid="menu-item-replay-plans-tour"
                  >
                    <BookOpen className="w-3.5 h-3.5 mr-2" />
                    Show me the tour again
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
