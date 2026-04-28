import { useEffect } from "react";
import type { Tool } from "../types";
import {
  ORTHO_PRESETS,
  RESERVED_KEYS,
  SNAP_MODE_ORDER,
  findShortcut,
  type ConstraintMode,
  type ShortcutContext,
  type SnapMode,
} from "./takeoff-shortcuts";

export interface UseTakeoffShortcutsParams {
  enabled: boolean;
  /** Activates the underlying canvas tool. */
  setActiveTool: (t: Tool) => void;
  /** Constraint group (radio). */
  setConstraintMode: (m: ConstraintMode) => void;
  constraintMode: ConstraintMode;
  /** Snap group (multi-select). */
  enabledSnapModes: SnapMode[];
  setEnabledSnapModes: (modes: SnapMode[]) => void;
  /** Ortho preset cycle index for `Shift+O`. */
  orthoPresetIndex: number;
  setOrthoPresetIndex: (i: number) => void;
  /** Ortho on/off (separate from preset; `O` toggles this). */
  orthoLock: boolean;
  setOrthoLock: (v: boolean) => void;
  /** Snap HUD overlay state — `S` opens it, `1`–`7` toggle modes while open. */
  snapHudOpen: boolean;
  setSnapHudOpen: (v: boolean) => void;
  /** Cheat-sheet overlay — `Cmd/Ctrl+/` and `?` open it. */
  setCheatSheetOpen: (v: boolean) => void;
  /** Grid snap toggle (also exposed as the View > Grid ribbon button). */
  gridEnabled: boolean;
  setGridEnabled: (v: boolean) => void;
  /** Sheet/version navigation. */
  onPrevSheet: () => void;
  onNextSheet: () => void;
  onPrevVersion?: () => void;
  onNextVersion?: () => void;
  /** Calibrate (`T`) opens the inline scale drawer. */
  onOpenCalibrate: () => void;
  /** History — Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z. */
  onUndo: () => void;
  onRedo: () => void;
  /** Duplicate selected markup — Cmd/Ctrl+D. */
  onDuplicateSelection: () => void;
  /** True while a draw is mid-flight; tool keys must not switch tools. */
  isDrawing: boolean;
  /** True while inline calibration is active; tool keys are gated off. */
  calibrationActive: boolean;
}

/** Should this keyboard event be ignored because the user is typing
 *  into a form control or focused inside a Radix portal/dialog/menu?
 *  The cheat-sheet dialog is the one exception we deliberately let
 *  Esc through for — Radix handles its own Esc-to-close so we just
 *  return early when focus is inside any dialog/menu. */
function shouldIgnoreEvent(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  const path = event.composedPath();
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (node.closest("[data-radix-portal]")) return true;
    if (
      node.hasAttribute("data-radix-focus-guard") ||
      node.hasAttribute("data-radix-popper-content-wrapper")
    )
      return true;
    const role = node.getAttribute("role");
    if (role === "dialog" || role === "menu" || role === "listbox" || role === "combobox")
      return true;
  }
  return false;
}

/**
 * Single source of truth for the unified ribbon's keyboard handling.
 *
 * The hook iterates `SHORTCUTS` (declared in `takeoff-shortcuts.ts`)
 * looking for an entry whose keys + modifiers + context match the
 * incoming KeyboardEvent, then dispatches based on `intent.kind`.
 * Adding a new binding is one entry in `SHORTCUTS` plus (where
 * applicable) a new intent + dispatch arm in `runIntent` below.
 *
 * Note: Space-momentary-pan stays in `useTakeoffInteractions` because
 * it depends on canvas internals (drawingPoints, currentDrawingTool).
 * The legacy hook's tool-shortcut block is gated off via
 * `disableLegacyShortcuts` when this hook is active so the two
 * listeners can never fight over the same key.
 */
export function useTakeoffShortcuts(params: UseTakeoffShortcutsParams) {
  const {
    enabled,
    setActiveTool,
    setConstraintMode,
    enabledSnapModes,
    setEnabledSnapModes,
    orthoPresetIndex,
    setOrthoPresetIndex,
    orthoLock,
    setOrthoLock,
    snapHudOpen,
    setSnapHudOpen,
    setCheatSheetOpen,
    gridEnabled,
    setGridEnabled,
    onPrevSheet,
    onNextSheet,
    onPrevVersion,
    onNextVersion,
    onOpenCalibrate,
    onUndo,
    onRedo,
    onDuplicateSelection,
    isDrawing,
    calibrationActive,
  } = params;

  useEffect(() => {
    if (!enabled) return;

    const handler = (event: KeyboardEvent) => {
      if (RESERVED_KEYS.has(event.key)) return;
      if (shouldIgnoreEvent(event)) return;

      // Pick the most-specific context first so HUD-specific bindings
      // (like the digits 1–7) override their idle-context counterparts.
      const contexts: ShortcutContext[] = [];
      if (snapHudOpen) contexts.push("snap-hud");
      if (isDrawing) contexts.push("drawing");
      contexts.push("idle");

      let matched = null;
      for (const ctx of contexts) {
        matched = findShortcut(event, ctx);
        if (matched) break;
      }
      if (!matched) return;

      // Tool keys are gated off while a draw is in flight or the
      // inline calibration overlay is up — except for editing/global
      // shortcuts (undo/redo/duplicate/cheat-sheet) which always work.
      const isToolish =
        matched.intent.kind === "select-tool" ||
        matched.intent.kind === "noop-tool" ||
        matched.intent.kind === "open-snap-hud" ||
        matched.intent.kind === "toggle-grid" ||
        matched.intent.kind === "open-calibrate";
      if (isToolish && (calibrationActive || isDrawing)) return;

      event.preventDefault();
      runIntent(matched.intent);
    };

    function runIntent(intent: ReturnType<typeof findShortcut> extends null
      ? never
      : NonNullable<ReturnType<typeof findShortcut>>["intent"]) {
      switch (intent.kind) {
        case "select-tool":
          setActiveTool(intent.tool);
          return;
        case "noop-tool":
          // D is a placeholder for the dimension callout — consume the
          // key so it never falls through but make no state change.
          return;
        case "open-snap-hud":
          setSnapHudOpen(!snapHudOpen);
          return;
        case "toggle-snap-mode": {
          const mode = intent.mode;
          if (enabledSnapModes.includes(mode)) {
            setEnabledSnapModes(enabledSnapModes.filter((m) => m !== mode));
          } else {
            setEnabledSnapModes([...enabledSnapModes, mode]);
          }
          return;
        }
        case "close-modal":
          setSnapHudOpen(false);
          return;
        case "toggle-grid":
          setGridEnabled(!gridEnabled);
          return;
        case "open-calibrate":
          onOpenCalibrate();
          return;
        case "toggle-ortho": {
          const nextOrtho = !orthoLock;
          setOrthoLock(nextOrtho);
          setConstraintMode(nextOrtho ? "ortho" : "none");
          return;
        }
        case "cycle-ortho-preset": {
          const next = (orthoPresetIndex + 1) % ORTHO_PRESETS.length;
          setOrthoPresetIndex(next);
          const preset = ORTHO_PRESETS[next];
          if (preset === null) {
            setConstraintMode("none");
            setOrthoLock(false);
          } else {
            setConstraintMode("ortho-angle");
            setOrthoLock(true);
          }
          return;
        }
        case "prev-sheet":
          onPrevSheet();
          return;
        case "next-sheet":
          onNextSheet();
          return;
        case "prev-version":
          onPrevVersion?.();
          return;
        case "next-version":
          onNextVersion?.();
          return;
        case "undo":
          onUndo();
          return;
        case "redo":
          onRedo();
          return;
        case "duplicate":
          onDuplicateSelection();
          return;
        case "open-cheat-sheet":
          setCheatSheetOpen(true);
          return;
        case "drawing-commit":
        case "drawing-cancel":
        case "drawing-back":
          // Owned by `useTakeoffInteractions` — its drawing handler is
          // already mounted and gated by `isDrawing`. We just declare
          // these in `SHORTCUTS` so they appear in the cheat sheet;
          // we do not preventDefault them here so the legacy handler
          // can still fire. (The `event.preventDefault()` above is
          // a no-op for browsers because we don't return early.)
          return;
        default: {
          // exhaustiveness check
          const _exhaustive: never = intent;
          void _exhaustive;
        }
      }
    }
    void SNAP_MODE_ORDER; // keep import side for future extensions

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    enabled,
    setActiveTool,
    setConstraintMode,
    enabledSnapModes,
    setEnabledSnapModes,
    orthoPresetIndex,
    setOrthoPresetIndex,
    orthoLock,
    setOrthoLock,
    snapHudOpen,
    setSnapHudOpen,
    setCheatSheetOpen,
    gridEnabled,
    setGridEnabled,
    onPrevSheet,
    onNextSheet,
    onPrevVersion,
    onNextVersion,
    onOpenCalibrate,
    onUndo,
    onRedo,
    onDuplicateSelection,
    isDrawing,
    calibrationActive,
  ]);
}
