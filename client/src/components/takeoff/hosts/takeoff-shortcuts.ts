import {
  MousePointer2,
  Hand,
  Lasso,
  Ruler,
  Square,
  Pentagon,
  CircleDashed,
  Circle as CircleIcon,
  MapPin,
  StickyNote,
  Type as TypeIcon,
  MoveUpRight,
  MessageSquare,
  Magnet,
  CornerDownRight,
  RotateCcw,
  Minus,
  Crosshair,
  Layers,
  Eye,
  History,
  Grid3x3,
  PenTool,
  Compass,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import type { Tool } from "../types";

export type SnapMode =
  | "endpoint"
  | "midpoint"
  | "intersection"
  | "perpendicular"
  | "center"
  | "nearest"
  | "grid";

export type ConstraintMode = "none" | "ortho" | "ortho-angle" | "polar";

/** Ortho preset cycle for `Shift+O`. The trailing `null` means "off". */
export const ORTHO_PRESETS: Array<number | null> = [15, 30, 45, 90, null];

export const SNAP_MODE_ORDER: SnapMode[] = [
  "endpoint",
  "midpoint",
  "intersection",
  "perpendicular",
  "center",
  "nearest",
  "grid",
];

export const SNAP_MODE_LABELS: Record<SnapMode, string> = {
  endpoint: "Endpoint",
  midpoint: "Midpoint",
  intersection: "Intersection",
  perpendicular: "Perpendicular",
  center: "Center",
  nearest: "Nearest",
  grid: "Grid",
};

export type RibbonGroupId =
  | "select"
  | "measure"
  | "annotate"
  | "snap"
  | "constrain"
  | "verify"
  | "view";

export const RIBBON_GROUP_LABELS: Record<RibbonGroupId, string> = {
  select: "Select",
  measure: "Measure",
  annotate: "Annotate",
  snap: "Snap",
  constrain: "Constrain",
  verify: "Verify",
  view: "View",
};

/* ============================================================== *
 *                                                                *
 *  SINGLE SOURCE OF TRUTH: SHORTCUTS                             *
 *                                                                *
 *  Every keyboard binding the takeoff workspace recognises is    *
 *  declared here. Three downstream consumers all read from this  *
 *  list so they can never drift apart:                           *
 *                                                                *
 *    1. `useTakeoffShortcuts` — matches a KeyboardEvent against  *
 *       the entries below by id and dispatches via an `intent`.  *
 *    2. `UnifiedTakeoffRibbon` — buttons look up their tooltip   *
 *       shortcut text by the entry's `id`.                       *
 *    3. `TakeoffShortcutCheatSheet` — renders these grouped by   *
 *       `groupId` (the seven ribbon group ids) plus a "Global"   *
 *       bucket for modal/editing/navigation keys.                *
 *                                                                *
 * ============================================================== */

export type ShortcutGroupId = RibbonGroupId | "global";

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroupId, string> = {
  ...RIBBON_GROUP_LABELS,
  global: "Global",
};

/** What the keyboard handler should do when a shortcut matches. The
 *  hook switches on `intent` so adding a new binding is just an entry
 *  in this list plus (where applicable) a new intent + handler. */
export type ShortcutIntent =
  | { kind: "select-tool"; tool: Tool }
  | { kind: "noop-tool" } // visible-but-disabled tool keys (e.g. D dimension)
  | { kind: "open-snap-hud" }
  | { kind: "toggle-snap-mode"; mode: SnapMode } // 1-7 inside snap HUD
  | { kind: "toggle-grid" }
  | { kind: "open-calibrate" }
  | { kind: "toggle-ortho" }
  | { kind: "cycle-ortho-preset" }
  | { kind: "prev-sheet" }
  | { kind: "next-sheet" }
  | { kind: "prev-version" }
  | { kind: "next-version" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "duplicate" }
  | { kind: "open-cheat-sheet" }
  | { kind: "close-modal" } // Esc closes snap HUD / cheat sheet
  | { kind: "drawing-commit" }
  | { kind: "drawing-cancel" }
  | { kind: "drawing-back" };

/** Modifier state required for a shortcut to match. */
export interface ShortcutModifiers {
  /** True → require Cmd OR Ctrl. False → require neither. */
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Where a shortcut is allowed to fire. `idle` = normal canvas state,
 *  `drawing` = mid-draw, `snap-hud` = the snap HUD overlay is open. */
export type ShortcutContext = "idle" | "drawing" | "snap-hud";

export interface Shortcut {
  /** Stable id used for tooltip/cheat-sheet lookups. */
  id: string;
  /** Display label, e.g. "V", "Shift+O", "Cmd/Ctrl+Z", "[", "?". Used by
   *  tooltips and the cheat sheet. */
  keys: string;
  /** Lowercased `event.key` we match against (e.g. "v", "o", "z", "[",
   *  "/", "escape", "enter", "backspace"). Digit modes are matched by
   *  parseInt when context = "snap-hud". */
  matchKey: string;
  modifiers?: ShortcutModifiers;
  /** Short, action-oriented label used in tooltips and cheat sheet. */
  label: string;
  /** Long-form description for cheat sheet (defaults to `label`). */
  description?: string;
  /** Which ribbon group this binding lives in for cheat-sheet
   *  grouping. `global` holds modal/editing keys that don't map to a
   *  specific ribbon group. */
  groupId: ShortcutGroupId;
  /** Allowed contexts. Default = `["idle"]`. */
  contexts?: ShortcutContext[];
  intent: ShortcutIntent;
  /** Set true so the cheat sheet can flag placeholder bindings. */
  comingSoon?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  // ── Select ──────────────────────────────────────────────────────
  {
    id: "tool.select",
    keys: "V",
    matchKey: "v",
    label: "Select / pointer",
    groupId: "select",
    intent: { kind: "select-tool", tool: "select" },
  },
  {
    id: "tool.pan",
    keys: "H",
    matchKey: "h",
    label: "Pan / hand",
    description: "Pan the canvas (hold Space for momentary pan)",
    groupId: "select",
    intent: { kind: "select-tool", tool: "pan" },
  },

  // ── Measure ─────────────────────────────────────────────────────
  {
    id: "tool.linear",
    keys: "L",
    matchKey: "l",
    label: "Linear measurement",
    groupId: "measure",
    intent: { kind: "select-tool", tool: "linear" },
  },
  {
    id: "tool.polyline",
    keys: "P",
    matchKey: "p",
    label: "Polyline",
    groupId: "measure",
    intent: { kind: "select-tool", tool: "segment" },
  },
  {
    id: "tool.area",
    keys: "A",
    matchKey: "a",
    label: "Area",
    groupId: "measure",
    intent: { kind: "select-tool", tool: "area" },
  },
  {
    id: "tool.arc",
    keys: "R",
    matchKey: "r",
    label: "Arc",
    groupId: "measure",
    intent: { kind: "select-tool", tool: "arc" },
  },
  {
    id: "tool.count",
    keys: "C",
    matchKey: "c",
    label: "Count",
    groupId: "measure",
    intent: { kind: "select-tool", tool: "count" },
  },

  // Drawing-time keys — live with the Measure group in the cheat sheet
  // because they only fire mid-draw on a measurement tool.
  {
    id: "drawing.commit",
    keys: "Enter",
    matchKey: "enter",
    label: "Commit current draw",
    description: "Auto-closes polygons when ≥3 vertices",
    groupId: "measure",
    contexts: ["drawing"],
    intent: { kind: "drawing-commit" },
  },
  {
    id: "drawing.cancel",
    keys: "Esc",
    matchKey: "escape",
    label: "Cancel current draw",
    groupId: "measure",
    contexts: ["drawing"],
    intent: { kind: "drawing-cancel" },
  },
  {
    id: "drawing.back",
    keys: "Backspace",
    matchKey: "backspace",
    label: "Drop last vertex",
    groupId: "measure",
    contexts: ["drawing"],
    intent: { kind: "drawing-back" },
  },

  // ── Annotate ────────────────────────────────────────────────────
  {
    id: "tool.note",
    keys: "N",
    matchKey: "n",
    label: "Note",
    groupId: "annotate",
    intent: { kind: "select-tool", tool: "note" },
  },
  {
    id: "tool.dimension",
    keys: "D",
    matchKey: "d",
    label: "Dimension callout",
    description: "Dimension callout (coming soon — key reserved)",
    groupId: "annotate",
    comingSoon: true,
    intent: { kind: "noop-tool" },
  },

  // ── Snap ────────────────────────────────────────────────────────
  {
    id: "snap.toggle-hud",
    keys: "S",
    matchKey: "s",
    label: "Open snap-mode HUD",
    description: "Open the snap HUD (then 1–7 toggle individual snap modes)",
    groupId: "snap",
    intent: { kind: "open-snap-hud" },
  },
  ...SNAP_MODE_ORDER.map<Shortcut>((mode, idx) => ({
    id: `snap.mode.${mode}`,
    keys: String(idx + 1),
    matchKey: String(idx + 1),
    label: `Toggle ${SNAP_MODE_LABELS[mode]} snap`,
    description: `Toggle ${SNAP_MODE_LABELS[mode]} snap (S then ${idx + 1})`,
    groupId: "snap",
    contexts: ["snap-hud"],
    intent: { kind: "toggle-snap-mode", mode },
  })),
  {
    id: "snap.close-hud",
    keys: "Esc",
    matchKey: "escape",
    label: "Close snap HUD",
    groupId: "snap",
    contexts: ["snap-hud"],
    intent: { kind: "close-modal" },
  },

  // ── Constrain ───────────────────────────────────────────────────
  {
    id: "constrain.ortho",
    keys: "O",
    matchKey: "o",
    label: "Toggle ortho",
    groupId: "constrain",
    intent: { kind: "toggle-ortho" },
  },
  {
    id: "constrain.ortho-angle",
    keys: "Shift+O",
    matchKey: "o",
    modifiers: { shift: true },
    label: "Cycle ortho preset",
    description: "15° → 30° → 45° → 90° → off",
    groupId: "constrain",
    intent: { kind: "cycle-ortho-preset" },
  },
  {
    id: "view.grid",
    keys: "G",
    matchKey: "g",
    label: "Toggle grid snap",
    groupId: "view",
    intent: { kind: "toggle-grid" },
  },

  // ── Verify ──────────────────────────────────────────────────────
  {
    id: "verify.calibrate",
    keys: "T",
    matchKey: "t",
    label: "Calibrate / set scale",
    groupId: "verify",
    intent: { kind: "open-calibrate" },
  },

  // ── View / Navigation ───────────────────────────────────────────
  {
    id: "nav.prev-sheet",
    keys: "[",
    matchKey: "[",
    label: "Previous sheet",
    groupId: "view",
    intent: { kind: "prev-sheet" },
  },
  {
    id: "nav.next-sheet",
    keys: "]",
    matchKey: "]",
    label: "Next sheet",
    groupId: "view",
    intent: { kind: "next-sheet" },
  },
  {
    id: "nav.prev-version",
    keys: ",",
    matchKey: ",",
    label: "Previous version",
    groupId: "view",
    intent: { kind: "prev-version" },
  },
  {
    id: "nav.next-version",
    keys: ".",
    matchKey: ".",
    label: "Next version",
    groupId: "view",
    intent: { kind: "next-version" },
  },

  // ── Global (modal / editing) ────────────────────────────────────
  {
    id: "edit.undo",
    keys: "Cmd/Ctrl+Z",
    matchKey: "z",
    modifiers: { meta: true },
    label: "Undo",
    groupId: "global",
    intent: { kind: "undo" },
  },
  {
    id: "edit.redo",
    keys: "Cmd/Ctrl+Shift+Z",
    matchKey: "z",
    modifiers: { meta: true, shift: true },
    label: "Redo",
    groupId: "global",
    intent: { kind: "redo" },
  },
  {
    id: "edit.redo-y",
    keys: "Cmd/Ctrl+Y",
    matchKey: "y",
    modifiers: { meta: true },
    label: "Redo (alt)",
    groupId: "global",
    intent: { kind: "redo" },
  },
  {
    id: "edit.duplicate",
    keys: "Cmd/Ctrl+D",
    matchKey: "d",
    modifiers: { meta: true },
    label: "Duplicate selected markup",
    groupId: "global",
    intent: { kind: "duplicate" },
  },
  {
    id: "modal.cheat-sheet",
    keys: "Cmd/Ctrl+/",
    matchKey: "/",
    modifiers: { meta: true },
    label: "Open this shortcut cheat-sheet",
    groupId: "global",
    intent: { kind: "open-cheat-sheet" },
  },
  {
    id: "modal.cheat-sheet-q",
    keys: "?",
    matchKey: "?",
    label: "Open this shortcut cheat-sheet",
    groupId: "global",
    intent: { kind: "open-cheat-sheet" },
  },
];

/** Lookup a shortcut by id. Used by ribbon tooltips. */
export const SHORTCUT_BY_ID: Record<string, Shortcut> = SHORTCUTS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<string, Shortcut>,
);

export interface RibbonToolDef {
  /** Stable id used in data-testid (`ribbon-tool-${id}`). */
  id: string;
  label: string;
  icon: LucideIcon;
  shortLabel?: string;
  /** Reference into `SHORTCUT_BY_ID` for tooltip / aria text. `null`
   *  for buttons with no keyboard binding. */
  shortcutId?: string | null;
  /** Underlying canvas Tool to activate when the button is pressed.
   *  `null` for buttons that trigger something other than a tool change
   *  (calibrate, dimension callout placeholder, view toggles). */
  tool: Tool | null;
  /** Tools whose canvas implementation is not yet wired up are visible-
   *  but-disabled per Section 1 ("muscle memory survives"). */
  disabled?: boolean;
  /** Free-text tooltip override; falls back to label + shortcut. */
  tooltip?: string;
  /** Custom action id for non-tool buttons. */
  action?:
    | "calibrate"
    | "verify-scale"
    | "dim-input"
    | "layers"
    | "overlay"
    | "versions"
    | "show-grid";
}

export interface RibbonGroupDef {
  id: RibbonGroupId;
  label: string;
  tools: RibbonToolDef[];
  /** Snap group is multi-select; constraint group is radio. The default
   *  group renders simple tool buttons. */
  kind?: "tools" | "snap" | "constrain";
}

export const RIBBON_GROUPS: RibbonGroupDef[] = [
  {
    id: "select",
    label: "Select",
    tools: [
      { id: "select", label: "Select", shortcutId: "tool.select", tool: "select", icon: MousePointer2 },
      {
        id: "lasso",
        label: "Lasso",
        shortcutId: null,
        tool: null,
        icon: Lasso,
        disabled: true,
        tooltip: "Lasso selection (coming soon)",
      },
      { id: "pan", label: "Pan", shortcutId: "tool.pan", tool: "pan", icon: Hand },
    ],
  },
  {
    id: "measure",
    label: "Measure",
    tools: [
      { id: "linear", label: "Linear", shortcutId: "tool.linear", tool: "linear", icon: Ruler },
      { id: "polyline", label: "Polyline", shortcutId: "tool.polyline", tool: "segment", icon: Pencil },
      { id: "area", label: "Area", shortcutId: "tool.area", tool: "area", icon: Square },
      {
        id: "polygon",
        label: "Polygon",
        shortcutId: null,
        tool: null,
        icon: Pentagon,
        disabled: true,
        tooltip: "Polygon (coming soon)",
      },
      { id: "arc", label: "Arc", shortcutId: "tool.arc", tool: "arc", icon: CircleDashed },
      {
        id: "circle",
        label: "Circle",
        shortcutId: null,
        tool: null,
        icon: CircleIcon,
        disabled: true,
        tooltip: "Circle (coming soon)",
      },
      { id: "count", label: "Count", shortcutId: "tool.count", tool: "count", icon: MapPin },
    ],
  },
  {
    id: "annotate",
    label: "Annotate",
    tools: [
      { id: "note", label: "Note", shortcutId: "tool.note", tool: "note", icon: StickyNote },
      {
        id: "dimension",
        label: "Dimension",
        shortcutId: "tool.dimension",
        tool: null,
        icon: TypeIcon,
        disabled: true,
        tooltip: "Dimension callout (coming soon)",
      },
      { id: "arrow", label: "Arrow", shortcutId: null, tool: "markup_arrow", icon: MoveUpRight },
      { id: "cloud", label: "Cloud", shortcutId: null, tool: "markup_cloud", icon: MessageSquare },
    ],
  },
  {
    id: "snap",
    label: "Snap",
    kind: "snap",
    tools: SNAP_MODE_ORDER.map((mode) => ({
      id: mode,
      label: SNAP_MODE_LABELS[mode],
      shortcutId: `snap.mode.${mode}`,
      tool: null,
      icon: mode === "grid" ? Grid3x3 : Magnet,
      tooltip: `${SNAP_MODE_LABELS[mode]} snap`,
    })),
  },
  {
    id: "constrain",
    label: "Constrain",
    kind: "constrain",
    tools: [
      { id: "none", label: "Free", shortcutId: null, tool: null, icon: Minus },
      { id: "ortho", label: "Ortho", shortcutId: "constrain.ortho", tool: null, icon: CornerDownRight },
      {
        id: "ortho-angle",
        label: "Ortho Angle",
        shortcutId: "constrain.ortho-angle",
        tool: null,
        icon: RotateCcw,
        tooltip: "Cycle ortho preset angle (15° / 30° / 45° / 90° / off)",
      },
      {
        id: "polar",
        label: "Polar",
        shortcutId: null,
        tool: null,
        icon: Compass,
        disabled: true,
        tooltip: "Polar tracking (coming soon)",
      },
    ],
  },
  {
    id: "verify",
    label: "Verify",
    tools: [
      {
        id: "calibrate",
        label: "Calibrate",
        shortcutId: "verify.calibrate",
        tool: null,
        icon: Ruler,
        action: "calibrate",
        tooltip: "Set sheet scale",
      },
      {
        id: "verify-scale",
        label: "Verify Scale",
        shortcutId: null,
        tool: null,
        icon: Crosshair,
        action: "verify-scale",
        disabled: true,
        tooltip: "Verify scale (coming soon)",
      },
      {
        id: "dim-input",
        label: "Dim Input",
        shortcutId: null,
        tool: null,
        icon: PenTool,
        action: "dim-input",
        disabled: true,
        tooltip: "Typed dimension input (coming soon)",
      },
    ],
  },
  {
    id: "view",
    label: "View",
    tools: [
      {
        id: "layers",
        label: "Layers",
        shortcutId: null,
        tool: null,
        icon: Layers,
        action: "layers",
        disabled: true,
        tooltip: "Layers (coming soon)",
      },
      {
        id: "overlay",
        label: "Overlay",
        shortcutId: null,
        tool: null,
        icon: Eye,
        action: "overlay",
        disabled: true,
        tooltip: "Overlay diff (coming soon)",
      },
      {
        id: "versions",
        label: "Versions",
        shortcutId: null,
        tool: null,
        icon: History,
        action: "versions",
        disabled: true,
        tooltip: "Version overlay",
      },
      {
        id: "show-grid",
        label: "Grid",
        shortcutId: "view.grid",
        tool: null,
        icon: Grid3x3,
        action: "show-grid",
      },
    ],
  },
];

/** Returns the localStorage key for per-user ribbon group collapsed state. */
export function ribbonGroupsStorageKey(userId: string | undefined | null): string | null {
  if (!userId) return null;
  return `takeoff-ribbon-groups-${userId}`;
}

/** Returns the localStorage key for per-user enabled snap modes. */
export function snapModesStorageKey(userId: string | undefined | null): string | null {
  if (!userId) return null;
  return `takeoff-snap-modes-${userId}`;
}

/** Returns the localStorage key for per-user constraint mode. */
export function constraintModeStorageKey(userId: string | undefined | null): string | null {
  if (!userId) return null;
  return `takeoff-constraint-mode-${userId}`;
}

/** Reserved keys that must never trigger a ribbon shortcut, per the
 *  interaction map. Browser/OS shortcuts (Cmd+T, etc.) are filtered by
 *  the keyboard handler's `metaKey/ctrlKey` checks. */
export const RESERVED_KEYS = new Set([
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
]);

/** Match a KeyboardEvent against a Shortcut. Returns true when keys
 *  + modifiers + context all line up. The hook filters by context
 *  before calling this. */
export function matchesShortcut(event: KeyboardEvent, s: Shortcut): boolean {
  if (event.key.toLowerCase() !== s.matchKey && event.key !== s.matchKey) {
    return false;
  }
  const meta = event.ctrlKey || event.metaKey;
  const wantMeta = !!s.modifiers?.meta;
  if (meta !== wantMeta) return false;
  const wantShift = !!s.modifiers?.shift;
  if (event.shiftKey !== wantShift) return false;
  const wantAlt = !!s.modifiers?.alt;
  if (event.altKey !== wantAlt) return false;
  return true;
}

/** Find the first SHORTCUTS entry that matches the event in the given
 *  context. Returns null when nothing matches. */
export function findShortcut(
  event: KeyboardEvent,
  context: ShortcutContext,
): Shortcut | null {
  for (const s of SHORTCUTS) {
    const contexts = s.contexts ?? ["idle"];
    if (!contexts.includes(context)) continue;
    if (matchesShortcut(event, s)) return s;
  }
  return null;
}
