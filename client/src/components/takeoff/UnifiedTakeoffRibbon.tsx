import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Keyboard, Cloud, CloudOff, Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  RIBBON_GROUPS,
  ORTHO_PRESETS,
  SHORTCUT_BY_ID,
  SNAP_MODE_LABELS,
  SNAP_MODE_ORDER,
  ribbonGroupsStorageKey,
  type ConstraintMode,
  type RibbonGroupId,
  type SnapMode,
} from "./hosts/takeoff-shortcuts";
import { DimInputHUD } from "./DimInputHUD";
import type { ParsedDimension, DefaultUnits } from "@/lib/takeoffTypedInput";
import type { Tool } from "./types";

export interface UnifiedTakeoffRibbonProps {
  userId: string | null | undefined;
  /** Active canvas tool — the matching Select/Measure/Annotate button
   *  is highlighted. */
  activeTool: Tool;
  onToolSelect: (tool: Tool) => void;
  /** Snap group state (multi-select). */
  enabledSnapModes: SnapMode[];
  setEnabledSnapModes: (modes: SnapMode[]) => void;
  snapHudOpen: boolean;
  setSnapHudOpen: (v: boolean) => void;
  /** Constrain group state (radio). `ortho` mirrors the legacy
   *  orthoLock flag; `ortho-angle` reflects an active preset. */
  constraintMode: ConstraintMode;
  setConstraintMode: (m: ConstraintMode) => void;
  orthoPresetIndex: number;
  setOrthoPresetIndex: (i: number) => void;
  orthoLock: boolean;
  setOrthoLock: (v: boolean) => void;
  /** View > Grid. */
  gridEnabled: boolean;
  setGridEnabled: (v: boolean) => void;
  /** Verify > Calibrate. */
  onOpenCalibrate: () => void;
  isCalibrated: boolean;
  /** Verify > Verify Scale — open the verify-scale dialog. */
  onStartVerifyScale: () => void;
  /** Verify > Dim Input — open the typed-dimension input dialog. */
  onOpenDimInput: () => void;
  /** View > Layers — toggle the categories visibility popover. */
  onShowLayers: () => void;
  /** Controlled open state for the Layers popover anchored to the
   *  ribbon button. The parent owns the state so other UI (the
   *  sidebar's full layer panel, keyboard shortcuts, etc.) can react
   *  to it. */
  layersPopoverOpen?: boolean;
  /** Called when Radix wants to close the popover (outside click,
   *  Escape, etc.). Parent should mirror the value into its
   *  `layersPopoverOpen` state. */
  onLayersPopoverOpenChange?: (open: boolean) => void;
  /** Called after the popover closes so the parent can return focus
   *  to the canvas (or wherever it makes sense in the host UI). */
  onLayersPopoverClose?: () => void;
  /** Measurement categories displayed inside the Layers popover with
   *  per-category visibility checkboxes bound to `hiddenCategoryIds`. */
  layersCategories?: ReadonlyArray<{ id: string; name: string; color: string }>;
  hiddenCategoryIds?: ReadonlySet<string>;
  onToggleCategoryVisibility?: (id: string) => void;
  /** View > Overlay — toggle the addenda overlay opacity panel. */
  onToggleOverlay: () => void;
  /** View > Versions — open the version history panel. */
  onShowVersions: () => void;
  /** Active states for the View action toggles. */
  overlayActive?: boolean;
  versionsActive?: boolean;
  layersActive?: boolean;
  verifyScaleActive?: boolean;
  dimInputActive?: boolean;
  /** Cheat-sheet trigger (right-rail keyboard button + Cmd/Ctrl+/). */
  onOpenCheatSheet: () => void;
  /** Offline / autosave indicator state. */
  isOffline: boolean;
  pendingOutboxCount: number;
  isSyncing: boolean;
  /** Show the labeled (icon + text) variant when the user has the
   *  "labeled toolbar" preference on. */
  labeled?: boolean;
  /** Task #2140 — Dim Input HUD wiring. The HUD is rendered next to
   *  the Measure group only when a measure draw is in progress so it
   *  doesn't intercept keystrokes during normal canvas use. */
  dimHudActive?: boolean;
  dimHudUnits?: DefaultUnits;
  onDimCommit?: (parsed: ParsedDimension, mode: "continue" | "finish") => void;
  onDimCancelTyped?: () => void;
  /** Tool Chest panel toggle — wired to the View ribbon group's
   *  "Tool Chest" button. */
  toolChestOpen?: boolean;
  onToggleToolChest?: () => void;
  /** Optional callback fired when the user right-clicks a tool button
   *  in the Measure or Annotate group. The handler typically pins the
   *  tool to the Tool Chest. When unset, no context menu mounts. */
  onPinTool?: (input: { toolId: string; label: string }) => void;
}

interface RibbonButtonState {
  active: boolean;
  disabled: boolean;
}

function shortcutKeysFor(shortcutId: string | null | undefined): string | null {
  if (!shortcutId) return null;
  return SHORTCUT_BY_ID[shortcutId]?.keys ?? null;
}

// Task #2142 — Narrow-viewport reflow.
//
// Below ~768px (typical phone landscape / split-screen tablet) the
// ribbon shrinks each tool to a touch-unfriendly 32px square and shows
// every group expanded, which both overflows the viewport horizontally
// and makes individual tool taps very error-prone with a fingertip.
//
// We respond by:
//  1. Bumping the active tool button hit-target from h-8 → h-11
//     (44px), which is Apple's iOS HIG and Google's Material minimum
//     for comfortable touch targets.
//  2. Default-collapsing the lower-priority secondary groups (snap,
//     constrain, view, verify, navigate) so the primary "Select /
//     Measure / Annotate" cluster fits without scrolling. Users can
//     still expand any collapsed group and the choice is persisted to
//     localStorage by the existing collapsed-state machinery; we only
//     change the *default* when the user has no stored preference for
//     that group yet.
const NARROW_VIEWPORT_BREAKPOINT_PX = 768;
const NARROW_DEFAULT_COLLAPSED_GROUPS: ReadonlySet<RibbonGroupId> = new Set<RibbonGroupId>([
  "snap",
  "constrain",
  "view",
  "verify",
]);

function useIsNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(`(max-width: ${NARROW_VIEWPORT_BREAKPOINT_PX - 1}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_BREAKPOINT_PX - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    // addEventListener is the modern API; older Safari only has the
    // deprecated addListener fallback, so support both.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);
  return narrow;
}

export function UnifiedTakeoffRibbon(props: UnifiedTakeoffRibbonProps) {
  const {
    userId,
    activeTool,
    onToolSelect,
    enabledSnapModes,
    setEnabledSnapModes,
    snapHudOpen,
    setSnapHudOpen,
    constraintMode,
    setConstraintMode,
    orthoPresetIndex,
    setOrthoPresetIndex,
    orthoLock,
    setOrthoLock,
    gridEnabled,
    setGridEnabled,
    onOpenCalibrate,
    isCalibrated,
    onStartVerifyScale,
    onOpenDimInput,
    onShowLayers,
    layersPopoverOpen = false,
    onLayersPopoverOpenChange,
    onLayersPopoverClose,
    layersCategories,
    hiddenCategoryIds,
    onToggleCategoryVisibility,
    onToggleOverlay,
    onShowVersions,
    overlayActive,
    versionsActive,
    layersActive,
    verifyScaleActive,
    dimInputActive,
    onOpenCheatSheet,
    isOffline,
    pendingOutboxCount,
    isSyncing,
    labeled,
    dimHudActive = false,
    dimHudUnits = "ft",
    onDimCommit,
    onDimCancelTyped,
    toolChestOpen,
    onToggleToolChest,
    onPinTool,
  } = props;

  // Per-user collapsed state for each ribbon group. Persisted so the
  // user's preferred layout survives reloads / sheet switches.
  //
  // userId may be null on first render (auth still loading) and arrive
  // later. We track which storageKey we've hydrated from so a late
  // userId rehydrates from localStorage exactly once instead of either
  // being lost (no read) or overwriting the stored prefs with the
  // empty default (eager write before read).
  const storageKey = ribbonGroupsStorageKey(userId);
  const [collapsed, setCollapsed] = useState<Record<RibbonGroupId, boolean>>(() => {
    if (!storageKey) return {} as Record<RibbonGroupId, boolean>;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return {} as Record<RibbonGroupId, boolean>;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<RibbonGroupId, boolean>;
    } catch {
      // ignore
    }
    return {} as Record<RibbonGroupId, boolean>;
  });
  const hydratedKeyRef = useRef<string | null>(storageKey);
  useEffect(() => {
    if (!storageKey || hydratedKeyRef.current === storageKey) return;
    // userId arrived (or changed) — rehydrate from the new namespace.
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setCollapsed(parsed as Record<RibbonGroupId, boolean>);
        }
      }
    } catch {
      // ignore
    }
    hydratedKeyRef.current = storageKey;
  }, [storageKey]);
  useEffect(() => {
    // Only persist after we've hydrated from the active key, otherwise
    // the empty-default `collapsed` would overwrite the stored prefs
    // before the late-arriving userId effect above gets a chance to read
    // them.
    if (!storageKey || hydratedKeyRef.current !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed, storageKey]);

  const isNarrowViewport = useIsNarrowViewport();

  // When the viewport is narrow we treat low-priority groups as
  // collapsed-by-default. The actual stored `collapsed` map is the
  // source of truth once the user touches a group toggle, so explicit
  // entries (true *or* false) always win over the narrow-default.
  const isGroupCollapsed = useCallback(
    (id: RibbonGroupId): boolean => {
      if (Object.prototype.hasOwnProperty.call(collapsed, id)) {
        return !!collapsed[id];
      }
      if (isNarrowViewport && NARROW_DEFAULT_COLLAPSED_GROUPS.has(id)) {
        return true;
      }
      return false;
    },
    [collapsed, isNarrowViewport],
  );

  const toggleGroup = useCallback(
    (id: RibbonGroupId) => {
      // Read through `isGroupCollapsed` so the first toggle on a
      // narrow viewport flips from the *effective* default (collapsed)
      // to expanded, instead of going from "no entry" → false (which
      // would still read as collapsed because of the narrow default).
      const currentlyCollapsed = isGroupCollapsed(id);
      setCollapsed((prev) => ({ ...prev, [id]: !currentlyCollapsed }));
    },
    [isGroupCollapsed],
  );

  // Roving tabindex per group. Tab moves group → group (each group
  // exposes exactly one tabIndex=0 button at a time); ←/→ moves
  // tool → tool inside the active group. Enter activates the focused
  // button (native <button> behavior).
  const [focusIndexByGroup, setFocusIndexByGroup] = useState<Partial<Record<RibbonGroupId, number>>>({});
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const setButtonRef = useCallback((key: string) => (el: HTMLButtonElement | null) => {
    buttonRefs.current[key] = el;
  }, []);

  const handleGroupKeyDown = useCallback(
    (groupId: RibbonGroupId, toolCount: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const cur = focusIndexByGroup[groupId] ?? 0;
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = (cur + delta + toolCount) % toolCount;
      setFocusIndexByGroup((prev) => ({ ...prev, [groupId]: next }));
      const refKey = `${groupId}:${next}`;
      const btn = buttonRefs.current[refKey];
      btn?.focus();
    },
    [focusIndexByGroup],
  );

  // For tool buttons in Select / Measure / Annotate groups, "active"
  // mirrors the canvas activeTool. Snap group active state is
  // multi-select; Constrain is radio.
  const buttonState = useCallback(
    (groupId: RibbonGroupId, toolId: string, tool: Tool | null, action?: string): RibbonButtonState => {
      if (groupId === "snap") {
        return { active: enabledSnapModes.includes(toolId as SnapMode), disabled: false };
      }
      if (groupId === "constrain") {
        if (toolId === "ortho") return { active: constraintMode === "ortho", disabled: false };
        if (toolId === "ortho-angle") return { active: constraintMode === "ortho-angle", disabled: false };
        if (toolId === "polar") return { active: constraintMode === "polar", disabled: false };
        if (toolId === "none") return { active: constraintMode === "none", disabled: false };
        return { active: false, disabled: false };
      }
      if (action === "show-grid") {
        return { active: gridEnabled, disabled: false };
      }
      if (action === "calibrate") {
        return { active: false, disabled: false };
      }
      if (action === "verify-scale") return { active: !!verifyScaleActive, disabled: false };
      if (action === "dim-input") return { active: !!dimInputActive, disabled: false };
      if (action === "layers") return { active: !!layersActive, disabled: false };
      if (action === "overlay") return { active: !!overlayActive, disabled: false };
      if (action === "versions") return { active: !!versionsActive, disabled: false };
      if (action === "tool-chest") {
        return { active: !!toolChestOpen, disabled: false };
      }
      return { active: !!tool && activeTool === tool, disabled: false };
    },
    [
      enabledSnapModes,
      constraintMode,
      gridEnabled,
      activeTool,
      verifyScaleActive,
      dimInputActive,
      layersActive,
      overlayActive,
      versionsActive,
      toolChestOpen,
    ],
  );

  const handleToolClick = useCallback(
    (
      groupId: RibbonGroupId,
      toolId: string,
      tool: Tool | null,
      action: string | undefined,
    ) => {
      if (groupId === "snap") {
        const mode = toolId as SnapMode;
        if (enabledSnapModes.includes(mode)) {
          setEnabledSnapModes(enabledSnapModes.filter((m) => m !== mode));
        } else {
          setEnabledSnapModes([...enabledSnapModes, mode]);
        }
        return;
      }
      if (groupId === "constrain") {
        if (toolId === "none") {
          setConstraintMode("none");
          setOrthoLock(false);
          return;
        }
        if (toolId === "ortho") {
          const next = !orthoLock;
          setOrthoLock(next);
          setConstraintMode(next ? "ortho" : "none");
          return;
        }
        if (toolId === "ortho-angle") {
          // Cycle preset (mirrors Shift+O).
          const nextIdx = (orthoPresetIndex + 1) % ORTHO_PRESETS.length;
          setOrthoPresetIndex(nextIdx);
          const preset = ORTHO_PRESETS[nextIdx];
          if (preset === null) {
            setConstraintMode("none");
            setOrthoLock(false);
          } else {
            setConstraintMode("ortho-angle");
            setOrthoLock(true);
          }
          return;
        }
        if (toolId === "polar") {
          if (constraintMode === "polar") {
            setConstraintMode("none");
            setOrthoLock(false);
          } else {
            setConstraintMode("polar");
            setOrthoLock(true);
          }
          return;
        }
        return;
      }
      if (action === "calibrate") {
        onOpenCalibrate();
        return;
      }
      if (action === "show-grid") {
        setGridEnabled(!gridEnabled);
        return;
      }
      if (action === "verify-scale") {
        onStartVerifyScale();
        return;
      }
      if (action === "dim-input") {
        onOpenDimInput();
        return;
      }
      if (action === "layers") {
        onShowLayers();
        return;
      }
      if (action === "overlay") {
        onToggleOverlay();
        return;
      }
      if (action === "versions") {
        onShowVersions();
        return;
      }
      if (action === "tool-chest") {
        onToggleToolChest?.();
        return;
      }
      if (tool) {
        onToolSelect(tool);
      }
    },
    [
      enabledSnapModes,
      setEnabledSnapModes,
      orthoLock,
      orthoPresetIndex,
      constraintMode,
      setConstraintMode,
      setOrthoLock,
      setOrthoPresetIndex,
      onOpenCalibrate,
      setGridEnabled,
      gridEnabled,
      onToolSelect,
      onStartVerifyScale,
      onOpenDimInput,
      onShowLayers,
      onToggleOverlay,
      onShowVersions,
      onToggleToolChest,
    ],
  );

  const orthoPresetLabel = useMemo(() => {
    const preset = ORTHO_PRESETS[orthoPresetIndex];
    return preset === null ? "off" : `${preset}°`;
  }, [orthoPresetIndex]);

  return (
    <div
      role="toolbar"
      aria-label="Takeoff ribbon"
      className="bg-card border-b shrink-0 w-full overflow-x-auto"
      data-testid="unified-takeoff-ribbon"
      data-narrow={isNarrowViewport ? "true" : "false"}
    >
      <div className="flex items-stretch gap-0 min-w-max">
        {RIBBON_GROUPS.map((group) => {
          const isCollapsed = isGroupCollapsed(group.id);
          const focusedIdx = focusIndexByGroup[group.id] ?? 0;
          return (
            <section
              key={group.id}
              role="group"
              aria-label={group.label}
              data-testid={`ribbon-group-${group.id}`}
              data-collapsed={isCollapsed ? "true" : "false"}
              className="flex flex-col border-r last:border-r-0 px-2 py-1 min-w-[80px]"
              onKeyDown={isCollapsed ? undefined : handleGroupKeyDown(group.id, group.tools.length)}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                /* Keep group-toggle headers OUT of the natural Tab order so
                 * pressing Tab moves focus group→group across the active
                 * tool of each group (each group exposes exactly one
                 * tabIndex=0 tool button). The toggle is still keyboard-
                 * reachable via shift-click or by mouse; arrow-key
                 * navigation handles in-group movement. */
                tabIndex={-1}
                className="flex items-center justify-between gap-1 px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover-elevate rounded"
                data-testid={`ribbon-group-toggle-${group.id}`}
                aria-expanded={!isCollapsed}
                aria-controls={`ribbon-group-tools-${group.id}`}
              >
                <span>{group.label}</span>
                {isCollapsed ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronUp className="w-3 h-3" />
                )}
              </button>
              {!isCollapsed && (
                <div
                  className="flex items-center gap-0.5 mt-1"
                  id={`ribbon-group-tools-${group.id}`}
                  data-testid={`ribbon-group-tools-${group.id}`}
                >
                  {group.tools.map((tool, idx) => {
                    const Icon = tool.icon;
                    const state = buttonState(group.id, tool.id, tool.tool, tool.action);
                    const disabled = !!tool.disabled || state.disabled;
                    const showShortcut = shortcutKeysFor(tool.shortcutId);
                    const tooltipText = tool.tooltip || tool.label;
                    const refKey = `${group.id}:${idx}`;
                    // Task #2139 — measure/annotate tools can be right-
                    // click-pinned to the Tool Chest. View-group tools
                    // (Layers/Overlay/etc.) and disabled tools are not
                    // pinnable.
                    const pinnable =
                      !!onPinTool &&
                      !disabled &&
                      (group.id === "measure" || group.id === "annotate");

                    // Single source of truth for the actual button.
                    // Both the Tooltip path and the ContextMenu path
                    // render the same button element (with narrow-
                    // viewport touch-target sizing from Task #2142 and
                    // Task #2202's aria-haspopup/expanded for Layers).
                    const buttonEl = (
                      <Button
                        ref={setButtonRef(refKey)}
                        type="button"
                        size="sm"
                        variant={state.active ? "secondary" : "ghost"}
                        disabled={disabled}
                        onClick={() =>
                          !disabled &&
                          handleToolClick(group.id, tool.id, tool.tool, tool.action)
                        }
                        tabIndex={focusedIdx === idx ? 0 : -1}
                        data-testid={`ribbon-tool-${tool.id}`}
                        data-active={state.active ? "true" : "false"}
                        data-disabled={disabled ? "true" : "false"}
                        aria-pressed={state.active}
                        aria-haspopup={tool.action === "layers" ? "dialog" : undefined}
                        aria-expanded={tool.action === "layers" ? layersPopoverOpen : undefined}
                        aria-label={tool.label}
                        className={cn(
                          "gap-1 text-xs",
                          isNarrowViewport
                            ? "h-11 min-w-[44px] px-3"
                            : "h-8 px-1.5",
                          state.active && "ring-1 ring-primary/40",
                        )}
                        onFocus={() =>
                          setFocusIndexByGroup((prev) => ({ ...prev, [group.id]: idx }))
                        }
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {labeled && <span className="hidden md:inline">{tool.label}</span>}
                        {showShortcut && (
                          <kbd className="hidden lg:inline px-1 py-0 text-[9px] font-mono bg-background/60 rounded border">
                            {showShortcut}
                          </kbd>
                        )}
                      </Button>
                    );
                    const tooltipContent = (
                      <TooltipContent side="bottom">
                        <div className="flex items-center gap-2">
                          <span>{tooltipText}</span>
                          {showShortcut && (
                            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border">
                              {showShortcut}
                            </kbd>
                          )}
                          {pinnable && (
                            <span className="text-[9px] text-muted-foreground">· right-click to pin</span>
                          )}
                        </div>
                      </TooltipContent>
                    );
                    // Tooltip-wrapped button. Used directly for Layers
                    // (which then gets its own Popover) and as the
                    // inner content for pinnable tools.
                    const buttonNode = (
                      <Tooltip>
                        <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
                        {tooltipContent}
                      </Tooltip>
                    );
                    // Task #2202 — anchor a one-click visibility
                    // popover to the Layers ribbon button. The popover
                    // is controlled (`open` from parent) so the
                    // existing button click handler keeps owning the
                    // toggle, and we only forward outside-click /
                    // Escape closes back through onOpenChange. Focus
                    // is returned to the canvas via onCloseAutoFocus →
                    // onLayersPopoverClose so estimators can
                    // immediately keep drawing. Layers lives in the
                    // "view" group, so `pinnable` is always false here
                    // and the ContextMenu wrapping below is a no-op
                    // for it.
                    if (tool.action === "layers") {
                      return (
                        <Popover
                          key={tool.id}
                          open={layersPopoverOpen}
                          onOpenChange={(next) => {
                            if (!next) onLayersPopoverOpenChange?.(false);
                          }}
                        >
                          <PopoverAnchor asChild>{buttonNode}</PopoverAnchor>
                          <PopoverContent
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className="w-64 p-0"
                            data-testid="popover-layers"
                            onCloseAutoFocus={(e) => {
                              e.preventDefault();
                              onLayersPopoverClose?.();
                            }}
                          >
                            <LayersPopoverPanel
                              categories={layersCategories ?? []}
                              hiddenCategoryIds={hiddenCategoryIds ?? new Set<string>()}
                              onToggleCategoryVisibility={onToggleCategoryVisibility}
                            />
                          </PopoverContent>
                        </Popover>
                      );
                    }
                    if (pinnable) {
                      return (
                        <ContextMenu key={tool.id}>
                          <ContextMenuTrigger asChild>
                            <span title={`${tooltipText} — right-click to pin`}>
                              {buttonNode}
                            </span>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onSelect={() => {
                                // Pin the canonical Tool enum value, not the display id —
                                // they diverge for Annotate (id "arrow"/"cloud" → tool
                                // "markup_arrow"/"markup_cloud") and Polyline (id "polyline"
                                // → tool "segment"). Activation calls `setActiveTool` with
                                // the stored refId, so storing the display id leaves the
                                // pinned tool inert. `tool.tool` is non-null for every
                                // pinnable entry (the `pinnable` guard rules out disabled
                                // tools, and every enabled measure/annotate tool has a
                                // non-null `tool`), but fall back to id defensively.
                                const refId = tool.tool ?? tool.id;
                                onPinTool?.({ toolId: refId, label: tool.label });
                              }}
                              data-testid={`ribbon-tool-pin-${tool.id}`}
                            >
                              Pin to Tool Chest
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    }
                    // Default: tooltip-wrapped button with the React
                    // key on the outer Tooltip.
                    return (
                      <Tooltip key={tool.id}>
                        <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
                        {tooltipContent}
                      </Tooltip>
                    );
                  })}
                  {group.id === "constrain" && (
                    <Badge
                      variant={
                        ORTHO_PRESETS[orthoPresetIndex] === null
                          ? "outline"
                          : "secondary"
                      }
                      className="ml-1 text-[9px] uppercase tracking-wide font-mono"
                      data-testid="ribbon-ortho-preset"
                      data-active={
                        ORTHO_PRESETS[orthoPresetIndex] === null
                          ? "false"
                          : "true"
                      }
                    >
                      ORTHO {orthoPresetLabel}
                    </Badge>
                  )}
                  {group.id === "measure" && onDimCommit && (
                    <DimInputHUD
                      active={dimHudActive}
                      units={dimHudUnits}
                      onCommit={onDimCommit}
                      onCancelTyped={onDimCancelTyped}
                    />
                  )}
                  {group.id === "verify" && isCalibrated && (
                    <Badge
                      variant="outline"
                      className="text-[9px] uppercase tracking-wide"
                      data-testid="ribbon-calibrated-badge"
                    >
                      Calibrated
                    </Badge>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {/* Right rail — snap HUD + autosave/offline indicator + cheat sheet */}
        <div className="flex items-center gap-2 ml-auto px-3 border-l">
          {snapHudOpen && (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded bg-muted/40 border"
              role="status"
              data-testid="snap-hud"
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                Snap
              </span>
              {SNAP_MODE_ORDER.map((mode, idx) => {
                const active = enabledSnapModes.includes(mode);
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      if (active) {
                        setEnabledSnapModes(enabledSnapModes.filter((m) => m !== mode));
                      } else {
                        setEnabledSnapModes([...enabledSnapModes, mode]);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover-elevate",
                      active && "bg-primary text-primary-foreground",
                    )}
                    data-testid={`snap-hud-mode-${mode}`}
                    data-active={active ? "true" : "false"}
                  >
                    <kbd className="px-0.5 font-mono">{idx + 1}</kbd>
                    <span>{SNAP_MODE_LABELS[mode]}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSnapHudOpen(false)}
                className="ml-1 px-1 text-[10px] text-muted-foreground hover-elevate rounded"
                data-testid="snap-hud-close"
              >
                Close
              </button>
            </div>
          )}

          <OfflineAutosaveIndicator
            isOffline={isOffline}
            pendingOutboxCount={pendingOutboxCount}
            isSyncing={isSyncing}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onOpenCheatSheet}
                data-testid="button-open-cheat-sheet"
              >
                <Keyboard className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="flex items-center gap-2">
                <span>Keyboard shortcuts</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border">
                  ⌘/
                </kbd>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

interface LayersPopoverPanelProps {
  categories: ReadonlyArray<{ id: string; name: string; color: string }>;
  hiddenCategoryIds: ReadonlySet<string>;
  onToggleCategoryVisibility?: (id: string) => void;
}

/**
 * One-click visibility toggles for every measurement category, rendered
 * inside the Layers ribbon popover (Task #2202). Each row maps to an
 * entry in `hiddenCategoryIds`: checked = visible, unchecked = hidden.
 * The full layer-management UI (rename / delete / label toggles) still
 * lives in the sidebar; this is the quick on/off complement.
 */
function LayersPopoverPanel({
  categories,
  hiddenCategoryIds,
  onToggleCategoryVisibility,
}: LayersPopoverPanelProps) {
  const visibleCount = categories.length - categories.filter((c) => hiddenCategoryIds.has(c.id)).length;
  return (
    <div className="flex flex-col" data-testid="layers-popover-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Layers
          </span>
        </div>
        <span
          className="text-[10px] text-muted-foreground"
          data-testid="text-layers-popover-count"
        >
          {visibleCount}/{categories.length} visible
        </span>
      </div>
      {categories.length === 0 ? (
        <p
          className="text-xs text-muted-foreground text-center px-3 py-6"
          data-testid="text-layers-popover-empty"
        >
          No categories yet. Create one from the sidebar to organize measurements.
        </p>
      ) : (
        <ScrollArea className="max-h-[320px]">
          <ul className="py-1" role="list">
            {categories.map((category) => {
              const isHidden = hiddenCategoryIds.has(category.id);
              const checkboxId = `layers-popover-checkbox-${category.id}`;
              return (
                <li key={category.id} className="px-1">
                  <label
                    htmlFor={checkboxId}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover-elevate",
                      isHidden && "opacity-60",
                    )}
                    data-testid={`row-layers-popover-${category.id}`}
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={!isHidden}
                      onCheckedChange={() => onToggleCategoryVisibility?.(category.id)}
                      aria-label={isHidden ? `Show ${category.name}` : `Hide ${category.name}`}
                      data-testid={`checkbox-layers-popover-${category.id}`}
                    />
                    <span
                      aria-hidden="true"
                      className="w-3 h-3 rounded-sm flex-shrink-0 border"
                      style={{ backgroundColor: isHidden ? "transparent" : category.color, borderColor: category.color }}
                    />
                    <span
                      className={cn(
                        "text-sm flex-1 min-w-0 truncate",
                        isHidden && "line-through text-muted-foreground",
                      )}
                    >
                      {category.name}
                    </span>
                    {isHidden ? (
                      <EyeOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

interface OfflineAutosaveIndicatorProps {
  isOffline: boolean;
  pendingOutboxCount: number;
  isSyncing: boolean;
}

type IndicatorState = "idle" | "saved" | "queued" | "syncing" | "offline";

const SAVED_FLASH_MS = 2000;

/** State machine:
 *  • offline           → amber chip, always visible
 *  • queued (≥1)       → amber chip, always visible
 *  • syncing           → muted spinner, always visible
 *  • idle (online, 0)  → hidden by default
 *  • saved (transient) → flash a "Saved" chip for SAVED_FLASH_MS when
 *    pendingOutboxCount drops back to zero, then fade to idle.
 */
function OfflineAutosaveIndicator({
  isOffline,
  pendingOutboxCount,
  isSyncing,
}: OfflineAutosaveIndicatorProps) {
  const prevPendingRef = useRef(pendingOutboxCount);
  const prevOfflineRef = useRef(isOffline);
  const [showSavedFlash, setShowSavedFlash] = useState(false);

  useEffect(() => {
    const droppedToZero =
      prevPendingRef.current > 0 && pendingOutboxCount === 0 && !isOffline;
    const cameBackOnline =
      prevOfflineRef.current && !isOffline && pendingOutboxCount === 0;
    if (droppedToZero || cameBackOnline) {
      setShowSavedFlash(true);
      const t = window.setTimeout(() => setShowSavedFlash(false), SAVED_FLASH_MS);
      return () => window.clearTimeout(t);
    }
  }, [pendingOutboxCount, isOffline]);

  useEffect(() => {
    prevPendingRef.current = pendingOutboxCount;
    prevOfflineRef.current = isOffline;
  }, [pendingOutboxCount, isOffline]);

  let state: IndicatorState;
  if (isOffline) state = "offline";
  else if (isSyncing) state = "syncing";
  else if (pendingOutboxCount > 0) state = "queued";
  else if (showSavedFlash) state = "saved";
  else state = "idle";

  // Hidden idle state — render an empty placeholder so the testid is
  // queryable but the chip is invisible. Tests assert the data-state
  // attribute to verify the state machine without depending on
  // visibility.
  if (state === "idle") {
    return (
      <div
        data-testid="indicator-offline-status"
        data-state="idle"
        aria-hidden="true"
        className="hidden"
      />
    );
  }

  let label: string;
  let Icon = Cloud;
  if (state === "offline") {
    Icon = CloudOff;
    label = pendingOutboxCount > 0
      ? `Offline · ${pendingOutboxCount} queued`
      : "Offline";
  } else if (state === "syncing") {
    Icon = Loader2;
    label = pendingOutboxCount > 0 ? `Syncing ${pendingOutboxCount}…` : "Syncing…";
  } else if (state === "queued") {
    Icon = Cloud;
    label = `${pendingOutboxCount} queued`;
  } else {
    label = "Saved";
  }

  const isWarn = state === "offline" || state === "queued";
  const isFading = state === "saved";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] transition-opacity duration-700",
            isWarn && "border-amber-300 text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-900/20",
            !isWarn && "border-muted text-muted-foreground",
            isFading && "opacity-70",
          )}
          data-testid="indicator-offline-status"
          data-state={state}
        >
          <Icon className={cn("w-3.5 h-3.5", state === "syncing" && "animate-spin")} />
          <span>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {state === "offline"
          ? "You're offline. Changes are queued and will sync when you reconnect."
          : state === "queued"
            ? `${pendingOutboxCount} change${pendingOutboxCount === 1 ? "" : "s"} pending sync.`
            : state === "syncing"
              ? "Syncing changes to the server…"
              : "All changes are saved."}
      </TooltipContent>
    </Tooltip>
  );
}
