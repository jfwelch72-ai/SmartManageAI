/**
 * Task #1609 — Toolbar that drives `<PlanMarkupLayer />`.
 * Mirrors the six tools from `takeoff_markups`: ARROW, TEXT, RECTANGLE,
 * CLOUD, HIGHLIGHT, FREEHAND. Tool, color, and thickness are owned by the
 * parent and passed down so the toolbar is fully controlled.
 *
 * Task #1631 — Now also embedded inside the bid-side `<TakeoffToolbar />`
 * markup popover so both surfaces show the same tool icons, color
 * swatches, thickness presets, default values, and active-state styling.
 * Optional `className`, `showLabel`, and `showSelect` props let the
 * takeoff popover reuse the component without the project-side surface
 * elements (header label, SELECT button — takeoff has its own select tool).
 */
import {
  ArrowUpRight,
  Square,
  Cloud,
  Type,
  Highlighter,
  Pencil,
  X,
  MousePointer2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MarkupTool } from "./MarkupRenderer";

export const MARKUP_TOOLBAR_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#a855f7",
  "#000000",
];
export const MARKUP_TOOLBAR_THICKNESSES = [1, 2, 4, 8];
export const MARKUP_TOOLBAR_DEFAULT_COLOR = MARKUP_TOOLBAR_COLORS[0];
export const MARKUP_TOOLBAR_DEFAULT_THICKNESS = 2;

const TOOLS: Array<{ tool: MarkupTool; label: string; Icon: typeof Square }> = [
  // SELECT lets users click an existing markup to select/delete it
  // without engaging a drawing tool. When no tool is active, the
  // overlay is transparent so PdfPreview pin-drop still works.
  { tool: "SELECT", label: "Select", Icon: MousePointer2 },
  { tool: "ARROW", label: "Arrow", Icon: ArrowUpRight },
  { tool: "RECTANGLE", label: "Rectangle", Icon: Square },
  { tool: "CLOUD", label: "Cloud", Icon: Cloud },
  { tool: "HIGHLIGHT", label: "Highlight", Icon: Highlighter },
  { tool: "FREEHAND", label: "Freehand", Icon: Pencil },
  { tool: "TEXT", label: "Text", Icon: Type },
];

export interface PlanMarkupToolbarProps {
  activeTool: MarkupTool | null;
  onChangeTool: (tool: MarkupTool | null) => void;
  color: string;
  onChangeColor: (color: string) => void;
  thickness: number;
  onChangeThickness: (thickness: number) => void;
  /** Override container classes. Defaults to the project-side horizontal
   *  toolbar styling; the takeoff popover supplies its own container. */
  className?: string;
  /** Show the leading "Markup:" label. PlansTab keeps it; the takeoff
   *  popover hides it because the popover header already says "Markup". */
  showLabel?: boolean;
  /** Render the SELECT button. PlansTab keeps it (no other select tool);
   *  the takeoff sidebar already has its own select tool, so it hides
   *  this entry to avoid duplication. */
  showSelect?: boolean;
}

export default function PlanMarkupToolbar({
  activeTool,
  onChangeTool,
  color,
  onChangeColor,
  thickness,
  onChangeThickness,
  className,
  showLabel = true,
  showSelect = true,
}: PlanMarkupToolbarProps) {
  const visibleTools = showSelect
    ? TOOLS
    : TOOLS.filter((t) => t.tool !== "SELECT");
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 border-b bg-card/60 px-2 py-1 text-xs",
        className,
      )}
      data-testid="plan-markup-toolbar"
    >
      {showLabel && <span className="text-muted-foreground mr-1">Markup:</span>}
      {visibleTools.map(({ tool, label, Icon }) => (
        <Button
          key={tool}
          type="button"
          size="sm"
          variant={activeTool === tool ? "default" : "ghost"}
          className="h-7 px-2"
          onClick={() => onChangeTool(activeTool === tool ? null : tool)}
          aria-pressed={activeTool === tool}
          aria-label={label}
          data-testid={`button-markup-tool-${tool.toLowerCase()}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </Button>
      ))}

      {activeTool && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => onChangeTool(null)}
          aria-label="Cancel markup tool"
          data-testid="button-markup-tool-cancel"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      )}

      <div className="mx-2 h-4 w-px bg-border" />

      <div className="flex items-center gap-1">
        {MARKUP_TOOLBAR_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={cn(
              "h-5 w-5 rounded-full border",
              color === c ? "ring-2 ring-offset-1 ring-foreground" : "ring-0",
            )}
            style={{ background: c }}
            onClick={() => onChangeColor(c)}
            aria-label={`Color ${c}`}
            data-testid={`button-markup-color-${c.replace("#", "")}`}
          />
        ))}
      </div>

      <div className="mx-2 h-4 w-px bg-border" />

      <div className="flex items-center gap-1">
        {MARKUP_TOOLBAR_THICKNESSES.map((t) => (
          <Button
            key={t}
            type="button"
            size="sm"
            variant={thickness === t ? "default" : "ghost"}
            className="h-7 w-7 p-0"
            onClick={() => onChangeThickness(t)}
            aria-label={`Thickness ${t}`}
            data-testid={`button-markup-thickness-${t}`}
          >
            <span style={{ fontSize: 10 }}>{t}px</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
